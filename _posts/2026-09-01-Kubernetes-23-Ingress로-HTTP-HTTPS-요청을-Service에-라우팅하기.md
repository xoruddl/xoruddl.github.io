---
layout: post
title: "Kubernetes (23) - Ingress로 HTTP/HTTPS 요청을 Service에 라우팅하기"
date: 2026-09-01 07:53:21 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "ingress", "ingress-controller", "service", "http", "https", "routing", "쿠버네티스"]
---

## 1. Ingress가 필요한 이유

`LoadBalancer` Service를 애플리케이션마다 만들면 외부 IP와 로드 밸런서가 서비스 수만큼 늘어날 수 있다. 웹 애플리케이션은 보통 하나의 도메인 아래에서 호스트 이름이나 URL 경로에 따라 여러 백엔드로 나누어 보내는 편이 자연스럽다.

Ingress는 클러스터 외부의 HTTP/HTTPS 요청을 내부 Service로 라우팅하는 Kubernetes API 리소스다. `api.example.com`은 API Service로, `web.example.com`은 웹 Service로 보내거나, 같은 도메인의 `/api`와 `/shop` 경로를 서로 다른 Service로 보낼 수 있다.

```text
사용자 → Ingress Controller의 외부 주소
              ├─ api.example.com/api → api Service → Pod
              └─ web.example.com/    → web Service → Pod
```

---

## 2. Ingress 리소스와 Controller의 역할

Ingress는 규칙을 선언하는 API 리소스일 뿐, YAML을 적용했다고 프록시가 자동으로 실행되지는 않는다. 규칙을 감시하고 실제 로드 밸런서·리버스 프록시 설정으로 바꾸는 **Ingress Controller**가 반드시 필요하다.

| 구성 요소 | 역할 |
| --- | --- |
| Ingress | 호스트·경로·TLS·백엔드 Service를 선언 |
| IngressClass | 어떤 Controller가 이 Ingress를 처리할지 식별 |
| Ingress Controller | Ingress 규칙을 감시하고 실제 HTTP/HTTPS 트래픽 처리 |
| Service | Controller가 최종적으로 요청을 전달할 안정적인 백엔드 |

Controller 자체도 외부에서 도달 가능해야 한다. 클라우드에서는 보통 Controller용 `LoadBalancer` Service를, 온프레미스에서는 MetalLB·NodePort·별도 프록시 등을 조합한다. 따라서 Ingress는 Service를 대체하는 타입이 아니라, 여러 Service 앞단의 L7 라우팅 계층이다.

---

## 3. 경로 기반 라우팅 예제

먼저 `web-service`, `api-service`라는 ClusterIP Service가 이미 존재한다고 가정한다. 다음 Ingress는 `app.example.com`의 `/api` 요청과 나머지 요청을 서로 다른 Service로 보낸다.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 80
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-service
                port:
                  number: 80
```

`pathType: Prefix`는 경로 접두사를 기준으로 일치시킨다. `/api` 규칙을 `/`보다 먼저 썼더라도, 구체적인 경로 규칙이 선택되는 방식과 경로 재작성 규칙은 사용하는 Controller의 문서를 확인해야 한다. 표준 Ingress API가 정의하지 않는 동작은 Controller별 annotation이나 CRD에 의존한다.

```bash
kubectl apply -f app-ingress.yaml
kubectl get ingress app-ingress
kubectl describe ingress app-ingress
```

로컬 실습에서는 Controller의 외부 IP를 `app.example.com`으로 해석하도록 테스트 머신의 DNS 또는 hosts 파일을 설정한 뒤 요청을 보낸다. 운영 환경에서는 DNS A/AAAA 또는 CNAME 레코드를 Controller의 외부 주소에 연결한다.

---

## 4. 호스트 기반 라우팅과 TLS

하나의 외부 주소에서 여러 도메인을 처리할 수도 있다. 각 규칙의 `host`를 다르게 지정하고, TLS Secret을 연결한다.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: multi-host-ingress
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.example.com
        - web.example.com
      secretName: example-com-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 80
    - host: web.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-service
                port:
                  number: 80
```

### 같은 주소로 들어온 요청을 도메인으로 구분하는 방식

두 도메인의 DNS 레코드는 모두 Ingress Controller의 같은 외부 IP 또는 로드 밸런서 주소를 가리킬 수 있다. 요청이 Controller에 도착하면 Controller는 URL의 도메인, 즉 HTTP `Host` 헤더를 먼저 확인해 어떤 `host` 규칙을 적용할지 결정한다. HTTPS에서는 TLS 연결을 시작할 때 전달되는 SNI 정보로 먼저 알맞은 인증서를 선택하고, 이후 HTTP 요청의 `Host`와 경로를 기준으로 백엔드 Service를 고른다.

| 요청 | 일치하는 규칙 | 전달 대상 |
| --- | --- | --- |
| `https://api.example.com/users` | `host: api.example.com`, `path: /` | `api-service:80` |
| `https://web.example.com/products` | `host: web.example.com`, `path: /` | `web-service:80` |

각 규칙의 `path`가 `/`이고 `pathType`이 `Prefix`이므로, 해당 도메인 아래의 모든 경로가 같은 Service로 전달된다. 따라서 `api.example.com`으로 들어오는 `/users`, `/health`, `/v1/items` 요청은 모두 `api-service`로 가고, `web.example.com`으로 들어오는 `/`, `/products`, `/about` 요청은 모두 `web-service`로 간다. 여기서 `/`는 두 도메인에 공통으로 적용되는 규칙이 아니라, **각 `host` 규칙 안에서만** 적용되는 기본 경로다.

도메인이 규칙과 일치하지 않으면 이 YAML에는 보낼 백엔드가 없다. 실제 응답은 Ingress Controller의 기본 백엔드 또는 설정에 따라 보통 404가 된다. 따라서 운영 환경에서는 `api.example.com`, `web.example.com`의 DNS가 Controller 주소를 가리키는지와 클라이언트가 올바른 도메인으로 요청하는지를 함께 확인해야 한다.

`example-com-tls` Secret은 대상 도메인에 맞는 인증서와 개인 키를 포함해야 한다. 인증서 발급·갱신을 자동화하려면 선택한 Controller와 호환되는 인증서 관리 도구의 운영 방법을 별도로 설계한다.

---

## 5. Ingress가 처리하지 않는 것

Ingress의 대상은 HTTP/HTTPS다. 임의의 TCP·UDP 포트, 데이터베이스 프로토콜처럼 HTTP가 아닌 트래픽을 노출하는 용도에는 일반적으로 `NodePort`, `LoadBalancer` 또는 해당 Controller의 별도 기능을 사용한다.

또한 Ingress는 인증·인가·요청 제한·경로 재작성 같은 기능을 표준 API로 모두 정의하지 않는다. 이런 기능은 Controller별 annotation이나 전용 정책 리소스를 통해 제공되며, 설정 이름과 동작이 구현체마다 다르다. 예전의 특정 Controller 설치 매니페스트와 annotation을 그대로 복사하기보다, 사용 중인 Controller의 현재 지원 범위와 버전을 확인해야 한다.

Kubernetes 프로젝트는 Ingress API가 안정적으로 유지되지만 더 이상 기능이 추가되지 않는다고 안내한다. 새로 복잡한 트래픽 제어를 설계한다면 더 확장성 있는 Gateway API도 함께 검토하는 것이 좋다. 기존 Ingress를 즉시 이전해야 한다는 뜻은 아니며, 단순한 HTTP 라우팅에는 Ingress가 계속 유효하다.

---

## 6. 정리

Ingress는 하나의 외부 진입점에서 호스트와 경로를 기준으로 여러 Service에 HTTP/HTTPS 트래픽을 나누는 L7 라우팅 리소스다. 실제 처리는 Ingress Controller가 담당하므로, 리소스와 Controller를 구분해서 이해해야 한다.

적용 전에는 Controller의 외부 노출 방식, `IngressClass`, DNS·TLS, 그리고 Controller별 확장 설정을 함께 확인한다. 단순한 경로 라우팅을 넘어선 새 요구 사항에는 Gateway API가 더 적합한지도 검토한다.

---

## 참고 자료

* [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
* [Kubernetes Service](https://kubernetes.io/docs/concepts/services-networking/service/)
