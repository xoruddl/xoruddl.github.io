---
layout: post
title: "Kubernetes (22) - 선택자 없는 Service와 EndpointSlice로 외부 백엔드 연결하기"
date: 2026-09-01 07:53:21 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "service", "endpointslice", "service-discovery", "external-service", "networking", "쿠버네티스"]
---

## 1. selector 없이도 Service를 만들 수 있다

일반적인 Service는 selector로 Pod를 찾고, Kubernetes가 EndpointSlice를 자동 생성한다. 그러나 관리형 데이터베이스, 다른 클러스터의 서비스, Kubernetes로 이전 중인 기존 서버처럼 백엔드가 현재 클러스터의 Pod가 아닐 때도 있다.

선택자 없는 Service는 이때도 클러스터 내부에 안정적인 Service 이름과 ClusterIP를 제공한다. 차이는 백엔드 목록을 Kubernetes가 자동으로 찾지 못하므로, 운영자가 `EndpointSlice`를 직접 관리해야 한다는 점이다.

```text
클라이언트 Pod → database.default.svc.cluster.local → ClusterIP
                                               ↓
                                  수동 EndpointSlice의 외부 IP 목록
```

---

## 2. Service와 EndpointSlice를 연결하는 방식

Service에서 `selector`를 생략한다. 그러면 EndpointSlice 컨트롤러는 이 Service의 엔드포인트를 만들지 않는다.

```yaml
# external-database-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: external-database
spec:
  ports:
    - name: postgres
      protocol: TCP
      port: 5432
      targetPort: 5432
```

이 Service와 연결할 EndpointSlice는 같은 네임스페이스에 만들고, `kubernetes.io/service-name` 레이블을 Service 이름과 일치시킨다. 아래 IP는 문서화용 예시 주소이므로 실제 연결 대상 주소로 바꿔야 한다.

```yaml
# external-database-endpoints.yaml
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: external-database-1
  labels:
    kubernetes.io/service-name: external-database
    endpointslice.kubernetes.io/managed-by: platform-team
addressType: IPv4
ports:
  - name: postgres
    protocol: TCP
    port: 5432
endpoints:
  - addresses:
      - "192.0.2.10"
    conditions:
      ready: true
  - addresses:
      - "192.0.2.11"
    conditions:
      ready: true
```

```bash
kubectl apply -f external-database-service.yaml
kubectl apply -f external-database-endpoints.yaml
kubectl get svc external-database
kubectl get endpointslice -l kubernetes.io/service-name=external-database
```

Service 포트 이름과 EndpointSlice 포트 이름을 맞춰 두면 여러 포트가 있는 Service도 명확하게 연결할 수 있다. `endpointslice.kubernetes.io/managed-by`에는 수동 관리 주체 또는 자체 컨트롤러를 식별할 값을 넣어 Kubernetes의 기본 컨트롤러와 구분한다.

---

## 3. 요청은 일반 Service처럼 분산된다

클라이언트는 백엔드가 외부에 있다는 사실을 알 필요 없이 Service DNS 이름으로 접속한다.

```bash
psql -h external-database.default.svc.cluster.local -p 5432 -U app
```

### Service DNS 이름 읽는 법

`external-database.default.svc.cluster.local`은 Kubernetes 내부 Service의 전체 도메인 이름(FQDN)이다. 각 부분은 다음 의미를 가진다.

```text
external-database.default.svc.cluster.local
│                 │       │   └─ 클러스터 DNS 도메인(설치 환경에 따라 변경 가능)
│                 │       └─ Service를 나타내는 고정 구분자
│                 └─ Namespace
└─ Service 이름
```

호출하는 Pod가 Service와 같은 네임스페이스에 있다면 보통 `external-database`만 써도 된다. 다른 네임스페이스의 Pod에서 호출할 때는 `external-database.default`처럼 네임스페이스까지 명시한다. `cluster.local`까지 포함한 FQDN은 같은 이름의 Service가 여러 네임스페이스에 있을 때처럼, 정확한 대상을 명확히 해야 하는 설정이나 진단에 유용하다.

Service 프록시는 연결된 EndpointSlice의 준비된 주소 가운데 하나로 트래픽을 전달한다. 따라서 외부 서버 여러 대를 EndpointSlice에 넣으면 ClusterIP Service를 통해 L4 수준의 분산을 사용할 수 있다.

다만 Kubernetes가 외부 서버의 상태를 자동으로 파악하거나 IP 변경을 감지하지는 않는다. 장애 감지, 주소 변경 반영, 인증서·보안 그룹 관리의 책임은 EndpointSlice를 갱신하는 운영 절차 또는 별도 컨트롤러에 남는다.

---

## 4. ExternalName과의 차이

외부 시스템을 Service 이름으로 추상화한다는 점에서 `ExternalName`과 비슷해 보이지만, 처리 계층이 다르다.

| 구분 | 선택자 없는 Service + EndpointSlice | ExternalName Service |
| --- | --- | --- |
| DNS 응답 | Service의 ClusterIP A/AAAA 레코드 | 외부 도메인을 가리키는 CNAME |
| 트래픽 경로 | Service 프록시가 EndpointSlice IP로 전달 | 클라이언트가 외부 도메인으로 직접 연결 |
| 여러 IP 분산 | Service 엔드포인트로 가능 | 외부 DNS와 클라이언트에 의존 |
| 관리 대상 | 외부 IP·포트를 직접 관리 | 외부 도메인 별칭을 관리 |

외부 제공자가 안정적인 DNS 이름을 제공하고 HTTP의 Host 헤더·TLS 이름 문제가 없다면 `ExternalName`이 간단할 수 있다. 반대로 외부 IP·포트를 명시적으로 제어하거나 Service 프록시를 통한 분산이 필요하면 선택자 없는 Service를 고려한다.

---

## 5. 제약과 운영 주의점

EndpointSlice의 주소에는 loopback·link-local 주소를 넣을 수 없다. 또한 다른 Kubernetes Service의 ClusterIP를 외부 엔드포인트처럼 넣는 것도 지원되지 않는다. kube-proxy는 가상 IP를 또 다른 가상 IP의 대상으로 처리하지 못하기 때문이다.

`kubectl port-forward service/<service-name>`도 선택자 없는 Service에는 동작하지 않는다. Kubernetes API 서버는 Pod에 매핑되지 않은 임의의 외부 엔드포인트를 프록시하지 않도록 제한한다. 연결 검증은 클러스터 내부의 테스트 Pod에서 Service DNS 이름으로 직접 수행한다.

---

## 6. 정리

선택자 없는 Service는 Kubernetes 밖의 서버도 클러스터 내부 Service 이름 뒤에 둘 수 있게 한다. selector를 생략하고 Service 이름 레이블이 일치하는 EndpointSlice를 직접 만들어 백엔드를 연결한다.

이 방식은 외부 시스템과의 느슨한 결합에 유용하지만, 외부 엔드포인트의 상태와 주소 변경까지 Kubernetes가 관리해 주지는 않는다. EndpointSlice 갱신 책임과 네트워크 접근 제어를 함께 설계해야 한다.

---

## 참고 자료

* [Kubernetes Service: Services without selectors](https://kubernetes.io/docs/concepts/services-networking/service/#services-without-selectors)
* [Kubernetes EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
