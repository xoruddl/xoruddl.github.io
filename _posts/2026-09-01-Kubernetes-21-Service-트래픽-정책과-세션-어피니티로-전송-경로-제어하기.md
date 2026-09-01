---
layout: post
title: "Kubernetes (21) - Service 트래픽 정책과 세션 어피니티로 전송 경로 제어하기"
date: 2026-09-01 07:53:21 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "service", "session-affinity", "externaltrafficpolicy", "topology-aware-routing", "networking", "쿠버네티스"]
---

## 1. Service의 분산 경로도 제어할 수 있다

일반 Service는 준비된 모든 엔드포인트 가운데 하나로 트래픽을 보낸다. 이 기본 동작은 무상태 웹 서버에 알맞지만, 클라이언트를 같은 Pod에 유지해야 하거나 외부 요청의 원본 IP를 보존해야 할 때는 추가 정책이 필요하다.

Service는 `sessionAffinity`, `externalTrafficPolicy`, `internalTrafficPolicy`, `trafficDistribution` 필드로 전송 대상과 경로를 조절한다. 이 글에서는 각 설정이 보장하는 범위와, 가용성에 미치는 영향을 함께 살펴본다.

---

## 2. Session Affinity: 같은 클라이언트를 같은 Pod로

`sessionAffinity: ClientIP`를 설정하면 같은 클라이언트 IP에서 온 새 연결을 일정 시간 동안 같은 백엔드 Pod로 보내도록 시도한다. 기본값은 `None`이며, 이 경우 Service는 매 연결을 일반적인 방식으로 분산한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: sample-session-affinity
spec:
  selector:
    app: sample-app
  ports:
    - name: http
      protocol: TCP
      port: 8080
      targetPort: 80
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10000
```

`timeoutSeconds`는 같은 클라이언트 IP와 선택된 엔드포인트의 연결 관계를 유지하는 시간이다. 시간이 지나거나 대상 Pod가 사라지면 이후 연결은 다른 준비된 Pod로 갈 수 있다.

다만 이것은 로그인 세션을 완전하게 보장하는 기능이 아니다. 여러 사용자가 NAT·프록시 뒤에서 하나의 원본 IP로 보일 수 있고, Pod 재시작·확장·축소에도 영향을 받는다. 가능하면 사용자 세션은 Redis·데이터베이스 같은 외부 저장소에 두고, 세션 어피니티는 보조 수단으로 사용하는 편이 견고하다.

---

## 3. externalTrafficPolicy: 외부 요청의 노드 간 홉 제어

`NodePort`와 `LoadBalancer` Service의 외부 요청은 노드에 도착한 뒤 다른 노드의 Pod로 한 번 더 전달될 수 있다. 기본값인 `externalTrafficPolicy: Cluster`는 클러스터 전체의 준비된 엔드포인트를 대상으로 하므로 분산에는 유리하지만, 노드 간 홉과 SNAT 때문에 애플리케이션에서 원본 클라이언트 IP를 보기 어려울 수 있다.

```text
Cluster (기본값)
클라이언트 → Node A → Node B의 Pod 가능

Local
클라이언트 → Node A → Node A의 Pod만 선택
```

다음처럼 `Local`을 설정하면 요청을 받은 노드의 로컬 엔드포인트만 사용한다. 일반적으로 원본 IP를 보존해야 하는 로그·접근 제어 요구에 사용한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: sample-nodeport-local
spec:
  type: NodePort
  externalTrafficPolicy: Local
  selector:
    app: sample-app
  ports:
    - name: http
      protocol: TCP
      port: 8080
      targetPort: 80
      nodePort: 30082
```

여기서 `Local`은 **요청이 어느 노드에 처음 도착할지 결정하는 설정이 아니다.** 클라이언트 또는 외부 LoadBalancer가 먼저 Node A에 요청을 전달하고, `externalTrafficPolicy`는 그 다음 단계에서 Node A가 백엔드 Pod를 어디서 찾을지를 정한다.

| 정책 | Node A에 요청이 도착했을 때 선택할 Pod | Node A에 준비된 Pod가 없을 때 |
| --- | --- | --- |
| `Cluster` (기본값) | Node A와 다른 노드를 포함한 모든 준비된 Pod | Node B 등 다른 노드의 Pod로 전달 가능 |
| `Local` | Node A에 있는 준비된 Pod만 | 다른 노드로 전달하지 않으므로 요청 실패 가능 |

예를 들어 Node A로 들어온 요청의 대상 Service Pod가 Node B에만 있다면, `Cluster` 정책은 `Node A → Node B의 Pod` 경로를 사용할 수 있다. 반대로 `Local` 정책은 Node B로 우회하지 않고 Node A의 로컬 엔드포인트만 찾는다. 로컬 엔드포인트가 없으면 그 노드에서는 Service에 사용할 백엔드가 없는 것으로 처리된다.

따라서 `Local`은 DaemonSet처럼 각 노드에 백엔드가 있거나, 외부 로드 밸런서가 로컬 엔드포인트가 있는 노드만 건강한 대상으로 선택할 수 있을 때 적합하다. 이 제약을 고려하지 않고 일반 Deployment에 적용하면, 일부 노드로 들어온 외부 요청이 간헐적으로 실패할 수 있다.

`LoadBalancer` 구현체는 `Local` 정책을 지원하기 위해 별도의 헬스 체크 포트를 사용할 수 있다.

---

## 4. internalTrafficPolicy: 내부 요청을 같은 노드에 한정하기

외부 요청과 별개로, Pod에서 Service로 가는 내부 요청에는 `internalTrafficPolicy`를 쓴다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: local-cache
spec:
  internalTrafficPolicy: Local
  selector:
    app: local-cache
  ports:
    - name: http
      port: 8080
      targetPort: 8080
```

`Local`이면 kube-proxy는 요청을 보낸 Pod와 같은 노드의 엔드포인트만 고려한다. 노드 로컬 캐시나 DaemonSet처럼 같은 노드의 백엔드를 반드시 사용해야 하는 경우에 유용하다.

하지만 로컬 엔드포인트가 없는 노드에서는 이 Service가 엔드포인트가 없는 것처럼 동작한다. 일반적인 Deployment에 무심코 적용하면 일부 노드의 클라이언트 요청이 실패할 수 있으므로, Pod 배치 전략과 함께 판단해야 한다.

---

## 5. 가까운 엔드포인트를 선호하는 토폴로지 설정

여러 가용 영역에 걸친 클러스터에서는 같은 영역의 Pod로 보내는 편이 지연 시간과 영역 간 트래픽 비용을 줄일 수 있다. 최신 Kubernetes에서는 `trafficDistribution`으로 이러한 **선호**를 표현할 수 있다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: zone-aware-api
spec:
  trafficDistribution: PreferSameZone
  selector:
    app: api
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

| 설정 | 의미 | 로컬 엔드포인트가 없을 때 |
| --- | --- | --- |
| `internalTrafficPolicy: Local` | 같은 노드만 사용하도록 강제 | 요청 실패 가능 |
| `externalTrafficPolicy: Local` | 외부 요청에서 같은 노드만 사용하도록 강제 | 그 노드로 온 요청 실패 가능 |
| `trafficDistribution: PreferSameZone` | 같은 영역 엔드포인트를 우선 선택 | 다른 영역 엔드포인트를 사용할 수 있음 |

`PreferSameZone`은 강제가 아니라 선호 정책이다. 모든 영역에 충분한 엔드포인트가 있고 노드의 영역 레이블이 올바를 때 효과적이다. 이전의 Topology Aware Hints 기반 설정도 여전히 볼 수 있지만, 클러스터 버전과 kube-proxy 구현이 지원하는 설정을 확인해야 한다.

---

## 6. 설정 전 확인할 질문

트래픽 정책을 선택하기 전에 다음을 확인한다.

* Pod가 모든 노드 또는 모든 영역에 충분히 배치되는가?
* 원본 IP가 실제로 필요한가? 필요한 이유가 감사 로그인지, IP 기반 인증인지 구분했는가?
* 외부 LoadBalancer가 `externalTrafficPolicy: Local`의 헬스 체크와 노드 선택을 지원하는가?
* 세션 상태를 Pod 메모리에만 저장하고 있지는 않은가?

정책을 강하게 제한할수록 불필요한 네트워크 홉은 줄어들지만, 엔드포인트 편중과 요청 실패 가능성은 커진다. 목표가 성능인지 원본 IP 보존인지, 또는 노드 로컬 처리인지 먼저 명확히 하는 것이 중요하다.

---

## 7. 정리

`sessionAffinity: ClientIP`는 같은 클라이언트를 같은 Pod에 유지하도록 돕지만, 영속적인 사용자 세션 저장소를 대체하지는 않는다. `externalTrafficPolicy: Local`은 외부 요청의 노드 간 전달을 막고 원본 IP 보존에 유용하지만, 로컬 Pod가 없는 노드에서는 요청을 처리할 수 없다.

내부 요청에는 `internalTrafficPolicy`, 영역 단위 최적화에는 `trafficDistribution`을 사용한다. 각 설정은 서로 다른 수준의 제약 또는 선호를 나타내므로, 백엔드 배치와 장애 상황까지 고려해 적용해야 한다.

---

## 참고 자료

* [Kubernetes Service](https://kubernetes.io/docs/concepts/services-networking/service/)
* [Service Internal Traffic Policy](https://kubernetes.io/docs/concepts/services-networking/service-traffic-policy/)
* [Topology Aware Routing](https://kubernetes.io/docs/concepts/services-networking/topology-aware-routing/)
