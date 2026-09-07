---
layout: post
title: "Kubernetes (36) - Blue-Green과 Canary로 배포 전략 선택하기"
date: 2026-09-07 16:09:49 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "deployment", "blue-green", "canary", "rolling-update", "배포전략", "쿠버네티스"]
---

새 버전을 배포하는 일은 단순히 Pod 이미지를 바꾸는 것보다 넓은 문제다. 기존 버전과 새 버전을 얼마나 오래 함께 실행할지, 어떤 기준으로 트래픽을 넘길지, 문제가 생겼을 때 얼마나 빨리 되돌릴지를 함께 결정해야 한다.

이 글에서는 Deployment의 기본 업데이트 방식인 RollingUpdate와, 트래픽 전환을 이용하는 Blue-Green·Canary 전략을 비교한다.

---

## 1. 배포 전략은 Pod 교체 방식과 트래픽 전환 방식을 함께 정한다

Kubernetes Deployment는 Pod 템플릿이 바뀌면 새 ReplicaSet을 만들고, 설정한 전략으로 이전 ReplicaSet을 줄인다. 기본값은 `RollingUpdate`이며, Deployment 자체가 지원하는 전략은 `RollingUpdate`와 `Recreate` 두 가지다.

반면 Blue-Green과 Canary는 Deployment 필드 하나로 켜는 기능이 아니라, **여러 버전의 워크로드를 어떻게 준비하고 Service·Ingress·Gateway 같은 트래픽 계층에서 어느 버전으로 보낼지**를 설계하는 배포 패턴이다.

| 전략 | 이전·새 버전의 동시 실행 | 트래픽 전환 | 장점 | 주의할 점 |
| --- | --- | --- | --- | --- |
| Recreate | 하지 않음 | 새 Pod가 준비된 뒤 재개 | 두 버전이 섞이지 않음 | 서비스 중단 발생 |
| RollingUpdate | 점진적으로 함께 실행 | Ready 상태인 새 Pod가 순차 참여 | Kubernetes 기본 기능만으로 구현 가능 | 두 버전 호환성·세션 처리 필요 |
| Blue-Green | 두 환경을 함께 유지 | 한 번에 대상 전환 | 빠른 되돌리기, 사전 검증 가능 | 거의 두 배의 자원 필요 |
| Canary | 비율 또는 조건에 따라 함께 실행 | 새 버전 트래픽을 단계적으로 확대 | 실제 트래픽에서 위험을 작게 검증 | 정교한 트래픽 제어·관측 필요 |

---

## 2. Recreate와 RollingUpdate는 Deployment의 기본 선택지다

`Recreate`는 이전 ReplicaSet의 Pod를 모두 종료한 뒤 새 Pod를 만든다. 이전 버전과 새 버전이 동시에 실행되면 안 되는 경우에는 단순한 선택지지만, 그 사이 요청을 처리할 Pod가 없으므로 무중단 서비스에는 맞지 않는다.

```yaml
spec:
  strategy:
    type: Recreate
```

`RollingUpdate`는 새 ReplicaSet을 늘리면서 이전 ReplicaSet을 줄인다. `maxSurge`는 원하는 복제본 수를 초과해 추가로 만들 수 있는 Pod 수이고, `maxUnavailable`은 업데이트 중 사용할 수 없어도 되는 Pod 수다. 두 값은 개수 또는 백분율로 지정할 수 있다.

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

위 설정은 새 Pod를 하나 더 만들고 Ready 상태가 된 것을 확인한 다음에만 기존 Pod를 줄이는 방향이다. 다만 종료 중인 Pod는 `terminationGracePeriodSeconds` 동안 남아 있을 수 있으므로, 롤아웃 순간의 실제 Pod 수와 자원 사용량은 `replicas + maxSurge`보다 잠시 많아질 수 있다.

RollingUpdate 중에는 이전·새 버전이 동시에 요청을 받는다. 데이터베이스 스키마, API 응답 형식, 캐시 키처럼 버전 간 호환성이 필요한 변경이라면 이를 먼저 보장해야 한다. 호환성을 보장하기 어렵거나 전환 시점을 명확히 통제해야 한다면 Blue-Green 또는 Canary를 검토한다.

---

## 3. Blue-Green은 Service의 선택 대상을 한 번에 바꾼다

Blue-Green 배포에서는 현재 운영 중인 버전(blue)과 새 버전(green)을 별도 Deployment로 함께 실행한다. 새 버전을 운영 트래픽에 연결하기 전, 별도 Service·포트 포워딩·테스트용 Ingress 등으로 검증한다. 검증이 끝나면 운영 Service의 selector를 green으로 변경한다.

```yaml
# 운영 Service: 현재 blue 버전을 선택
apiVersion: v1
kind: Service
metadata:
  name: print-version
spec:
  selector:
    app: print-version
    color: blue
  ports:
    - port: 80
      targetPort: 8080
```

전환 시에는 `color` 값만 `green`으로 바꿔 적용한다.

```yaml
spec:
  selector:
    app: print-version
    color: green
```

```bash
kubectl apply -f print-version-service.yaml
kubectl get endpointslices -l kubernetes.io/service-name=print-version
```

Service selector를 바꾸면 Kubernetes가 EndpointSlice를 갱신하고 이후 연결은 green Pod로 향한다. 다만 이미 맺어진 TCP 연결이나 애플리케이션이 보관한 세션이 즉시 이동하는 것은 아니다. 전환 후에도 blue Deployment를 잠시 유지하고, 오류율·지연 시간·핵심 기능을 확인한 뒤 제거해야 빠르게 되돌릴 수 있다.

```text
전환 전: Client → Service(selector: color=blue)  → blue Pod
전환 후: Client → Service(selector: color=green) → green Pod
```

---

## 4. Canary는 새 버전의 노출 범위를 작게 시작한다

Canary 배포는 새 버전을 일부 트래픽에만 먼저 노출하고, 관측 결과가 정상일 때 비율을 점차 높이는 방식이다. 예를 들어 10% 노출 후 오류율·응답 시간·비즈니스 지표를 확인하고, 50%, 100%로 확대할 수 있다. 문제가 생기면 새 버전으로 향하는 트래픽만 즉시 0으로 내려 영향 범위를 제한한다.

가장 단순한 방법은 같은 Service의 selector에 이전·새 버전 Pod를 모두 포함하고, 복제본 수 비율로 새 버전의 비중을 작게 두는 것이다. 이 방식은 간단하지만 연결별 분산 결과에 의존하므로 정확한 요청 비율을 보장하지 않으며, 사용자·헤더·경로별 규칙도 설정할 수 없다.

정확한 가중치나 조건 기반 분기가 필요하면 다음처럼 트래픽 계층 또는 배포 도구를 사용한다.

| 방법 | 적합한 경우 | 특징 |
| --- | --- | --- |
| 복제본 비율 | 간단한 내부 검증 | 구현은 쉽지만 정밀한 비율 제어는 어려움 |
| Ingress Controller의 Canary 기능 | HTTP 요청을 가중치·헤더·쿠키로 나눌 때 | 지원 기능과 애너테이션은 컨트롤러마다 다름 |
| Gateway API·서비스 메시 | 여러 서비스에 일관된 트래픽 정책이 필요할 때 | 플랫폼 구성과 운영 정책이 필요 |
| Argo Rollouts 같은 배포 컨트롤러 | 단계별 확대·중단·분석을 자동화할 때 | 별도 CRD와 컨트롤러를 설치·운영해야 함 |

Canary의 핵심은 새 버전 복제본을 적게 두는 데 있지 않다. 다음 단계로 확대할 판단 기준, 중단할 오류 기준, 되돌릴 담당자와 방법을 배포 전에 정해 두어야 한다.

---

## 5. 안전한 전환을 위한 사전 조건

어떤 전략을 선택하더라도 새 Pod가 실제 요청을 처리할 준비가 되기 전에는 트래픽을 받지 않아야 한다. Readiness Probe는 준비되지 않은 Pod를 Service Endpoint에서 제외하므로, RollingUpdate·Blue-Green·Canary 모두에 중요한 안전장치다. Probe의 설계는 [Kubernetes (35) - Probe로 컨테이너 상태 점검하기](/2026/09/04/Kubernetes-35-Probe로-컨테이너-상태-점검하기/)에서 확인할 수 있다.

기존 Pod를 종료할 때도 처리 중인 요청과 연결을 고려해야 한다. Kubernetes는 Pod 종료 시 컨테이너에 종료 신호를 보내고, `terminationGracePeriodSeconds` 안에 종료되지 않으면 강제 종료한다. 애플리케이션은 종료 신호를 받으면 새 요청 수신을 멈추고 진행 중인 요청을 정리하도록 구현한다. 필요하다면 `preStop` 훅으로 로드 밸런서에서 제외될 시간을 확보할 수 있지만, 훅 실행 시간도 종료 유예 시간에 포함되므로 너무 긴 대기 명령은 피한다.

배포 전에는 다음 항목을 점검한다.

| 점검 항목 | 확인할 내용 |
| --- | --- |
| 준비 상태 | Readiness Probe가 실제 요청 처리 가능 상태를 검사하는가 |
| 버전 호환성 | 구·신 버전이 동시에 실행될 때 API·스키마·캐시가 호환되는가 |
| 종료 처리 | 종료 신호, 연결 드레이닝, `terminationGracePeriodSeconds`가 애플리케이션 특성에 맞는가 |
| 관측 기준 | 오류율·지연 시간·핵심 비즈니스 지표의 확대·중단 기준이 있는가 |
| 되돌리기 | 이전 버전과 트래픽 전환 설정을 얼마나 유지하며, 누가 어떤 명령으로 복구하는가 |

---

## 6. 정리

`Recreate`와 RollingUpdate는 Deployment가 제공하는 Pod 교체 전략이다. 두 버전의 공존이 가능하고 점진적으로 교체해도 된다면 RollingUpdate가 기본 선택이지만, 호환성이나 서비스 중단 허용 범위를 먼저 확인해야 한다.

Blue-Green은 검증을 끝낸 새 환경으로 트래픽을 한 번에 전환해 빠른 롤백을 돕고, Canary는 실제 트래픽의 일부에서 새 버전을 검증하며 위험을 줄인다. 어느 전략이든 Readiness Probe, 정상 종료, 측정 가능한 성공·중단 기준, 즉시 실행 가능한 롤백 절차가 함께 갖춰져야 안전한 배포가 된다.

---

## 참고 자료

* [Kubernetes 문서 - Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
* [Kubernetes 문서 - Service](https://kubernetes.io/docs/concepts/services-networking/service/)
* [Kubernetes 문서 - Pod 종료 흐름](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination-flow)
* [Argo Rollouts 문서](https://argoproj.github.io/rollouts/)
