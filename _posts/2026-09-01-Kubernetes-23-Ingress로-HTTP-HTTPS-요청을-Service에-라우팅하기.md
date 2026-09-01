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

### 로컬·베어메탈 환경에서의 준비

로컬 또는 베어메탈 클러스터에는 클라우드 제공자의 Load Balancer 구현이 없으므로, Ingress Controller를 외부에 노출할 방법을 먼저 준비해야 한다. `LoadBalancer` Service에 외부 IP를 할당하고 싶다면 MetalLB를 설치할 수 있고, 필요에 따라 NodePort나 별도 프록시를 사용할 수도 있다. MetalLB는 Ingress 자체의 필수 구성 요소가 아니라, 로컬 환경에서 `LoadBalancer` 타입을 구현하는 선택지다.

또한 NGINX Ingress Controller와 해당 `IngressClass`가 설치되어 있어야 한다. 아래 명령으로 Controller Service의 외부 주소와 사용할 클래스 이름을 확인한다. Controller의 배포 방법과 Service 이름은 설치 방식·버전에 따라 다를 수 있다.

```bash
kubectl get ingressclass
kubectl get svc -n ingress-nginx
```

예를 들어 Controller Service의 `EXTERNAL-IP`가 `192.168.56.20`이라면, 이 주소가 HTTP/HTTPS 요청의 실제 진입점이다. `EXTERNAL-IP`가 `<pending>`이면 아직 외부 IP를 할당할 구성 요소가 준비되지 않았다는 뜻이므로 Ingress 규칙부터 점검하기보다 Controller 노출 방식을 먼저 확인한다.

---

## 3. 경로 기반 라우팅 예제

먼저 `web-service`, `api-service`라는 ClusterIP Service가 이미 존재한다고 가정한다. Ingress와 백엔드 Service는 같은 Namespace에 있어야 한다. 다음 Ingress는 `app.example.com`의 `/api` 요청과 나머지 요청을 서로 다른 Service로 보낸다.

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

`pathType: Prefix`는 경로 요소 단위의 접두사를 기준으로 일치시킨다. 따라서 `/api`는 `/api`, `/api/`, `/api/users`와 일치하지만 `/apiv1`과는 일치하지 않는다. 같은 호스트에서 여러 경로가 일치하면 표준 Ingress 규칙상 가장 긴 경로가 우선하므로, `/api/users`는 YAML에서 `/api`를 `/`보다 먼저 작성했는지와 무관하게 `api-service`로 전달된다.

이 예시는 백엔드에 원래 요청 경로를 그대로 전달한다. 예를 들어 백엔드는 `/api/users` 요청을 그대로 받는다. 백엔드가 `/users`처럼 다른 경로를 기대할 때만 Controller별 재작성 기능을 사용한다. 특히 ingress-nginx의 `nginx.ingress.kubernetes.io/rewrite-target: /`는 모든 일치 요청을 `/`로 바꾸므로, 단순한 Prefix 라우팅 예제에는 넣지 않는 편이 명확하다.

```bash
kubectl apply -f app-ingress.yaml
kubectl get ingress app-ingress
kubectl describe ingress app-ingress
```

### 로컬에서 라우팅 확인하기

DNS 레코드를 만들지 않아도 `curl --resolve`로 특정 도메인을 Controller 외부 IP에 임시로 연결해 확인할 수 있다. 아래의 `192.168.56.20`은 예시이므로 실제 Controller의 `EXTERNAL-IP`로 바꾼다.

```bash
curl -s --resolve app.example.com:80:192.168.56.20 http://app.example.com/api
curl -s --resolve app.example.com:80:192.168.56.20 http://app.example.com/
```

테스트 머신의 `/etc/hosts`를 사용하는 방법도 있다. 여러 호스트 기반 규칙을 시험할 때는 모든 도메인을 **Controller의 동일한 외부 IP**에 연결한다.

```text
192.168.56.20 app.example.com api.example.com web.example.com
```

그 뒤 `curl http://app.example.com/api` 또는 `curl http://api.example.com/users`처럼 요청한다. NodePort로 Controller에 접근하는 환경이라면 hosts 파일에는 접근 가능한 Controller 노드 IP를 넣고, `http://app.example.com:<NodePort>`처럼 NodePort를 명시한다. `LoadBalancer`의 외부 IP를 쓰는 방식과 NodePort 방식을 섞지 않도록 주의한다. 운영 환경에서는 DNS A/AAAA 또는 CNAME 레코드를 Controller의 외부 주소에 연결한다.

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
* [ingress-nginx: Basic usage](https://kubernetes.github.io/ingress-nginx/user-guide/basic-usage/)
* [ingress-nginx: Rewrite](https://kubernetes.github.io/ingress-nginx/examples/rewrite/)
