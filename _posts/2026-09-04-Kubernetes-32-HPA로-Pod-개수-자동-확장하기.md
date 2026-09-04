---
layout: post
title: "Kubernetes (32) - HPA로 Pod 개수 자동 확장하기"
date: 2026-09-04 08:39:43 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "hpa", "horizontal-pod-autoscaler", "autoscaling", "metrics-server", "resources", "쿠버네티스"]
---

웹 요청이 늘어날 때 Pod를 사람이 직접 늘리고, 한가해지면 다시 줄이는 일은 반복적이고 늦기 쉽다. Horizontal Pod Autoscaler(HPA)는 관측한 지표를 바탕으로 Deployment 같은 워크로드의 복제본 수를 자동으로 조절한다.

HPA는 컨테이너 한 개의 크기를 키우는 기능이 아니라, 같은 Pod를 **가로 방향으로 여러 개** 늘리거나 줄이는 기능이다. CPU 기준 HPA를 이해하려면 앞 글의 `requests.cpu`가 왜 중요한지도 함께 알아야 한다.

---

## 1. HPA는 Pod 수를 바꾼다

```text
사용자 요청 증가
      ↓
Pod의 평균 CPU 사용률이 목표보다 높음
      ↓
HPA가 Deployment의 replicas 증가
      ↓
새 Pod가 스케줄링되어 요청 분산
```

HPA는 Deployment, StatefulSet처럼 `scale` 하위 리소스를 제공하는 워크로드의 복제본 수를 조절할 수 있다. 최소·최대 복제본 수를 지정하므로, 갑자기 무한히 늘어나는 설정이 되지는 않는다.

| 기능 | 조절 대상 | 예시 |
| --- | --- | --- |
| HPA | Pod 개수 | 웹 서버 2개 → 5개 |
| VPA | Pod의 CPU·메모리 요청량 | 한 Pod의 요청 메모리 조정 |
| Cluster Autoscaler | 노드 개수 | 워커 노드 3대 → 4대 |

HPA는 다음 글에서 다룰 Cluster Autoscaler와 자주 함께 쓰이지만, 서로 다른 문제를 해결한다.

---

## 2. CPU 사용률에는 requests가 기준이 된다

CPU 사용률 기반 HPA는 단순한 CPU 사용량이 아니라, 각 컨테이너의 CPU `requests`와 비교한 사용률을 이용한다. 예를 들어 `requests.cpu: 200m`인 컨테이너가 평균 `140m`을 사용하면 CPU 사용률은 70%다.

따라서 CPU 사용률을 목표로 쓰려면 대상 컨테이너에 `requests.cpu`가 필요하다. 요청량이 없으면 HPA는 해당 컨테이너의 CPU 사용률을 계산할 기준이 없어 원하는 방식으로 동작하지 않는다.

필요한 복제본 수는 개념적으로 다음처럼 계산한다.

```text
ceil(현재 복제본 수 × 현재 평균 사용률 ÷ 목표 사용률)
```

예를 들어 Pod가 2개이고 평균 CPU 사용률이 90%, 목표가 60%라면 `ceil(2 × 90 ÷ 60)`이므로 HPA는 3개를 목표로 계산한다. 실제 동작에는 준비 중인 Pod 처리, 안정화 구간, 설정한 동작 정책 등도 반영된다.

---

## 3. Metrics Server가 준비되어 있는지 확인한다

CPU·메모리 기준 HPA는 리소스 메트릭 API에서 값을 읽는다. 많은 클러스터에서 Metrics Server가 이 역할을 한다.

```bash
kubectl top nodes
kubectl top pods
```

두 명령에서 사용량이 보이면 기본 리소스 메트릭을 조회할 수 있는 상태다. `Metrics API not available` 같은 오류가 난다면 HPA 매니페스트보다 먼저 클러스터의 Metrics Server 설치·상태를 확인해야 한다. 설치 방식은 관리형 Kubernetes, Minikube, kubeadm 환경마다 다를 수 있다.

---

## 4. Deployment와 HPA 만들기

다음 Deployment는 컨테이너 하나가 CPU `100m`을 요청하도록 설정한다. HPA는 평균 CPU 사용률을 70% 근처로 맞추려고 복제본 수를 2~10개 사이에서 조절한다.

```yaml
# sample-hpa.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sample-hpa-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: sample-hpa-app
  template:
    metadata:
      labels:
        app: sample-hpa-app
    spec:
      containers:
        - name: app
          image: nginx:1.27
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 300m
              memory: 256Mi
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: sample-hpa-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: sample-hpa-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

```bash
kubectl apply -f sample-hpa.yaml
kubectl get hpa
kubectl get deployment sample-hpa-app
```

`averageUtilization: 70`은 전체 대상 Pod의 평균 CPU 사용률을 각 컨테이너 CPU 요청량의 70% 수준으로 맞추려는 목표다. 위 예제에서는 Pod 하나당 CPU 요청이 `100m`이므로, 평균 사용량 약 `70m`이 기준이 된다.

---

## 5. 상태를 관찰하고 부하에 맞춰 검증한다

HPA가 어떻게 판단하는지 계속 관찰한다.

```bash
kubectl get hpa sample-hpa-app --watch
```

다른 터미널에서는 애플리케이션에 실제 요청을 보내고, 다음 명령으로 결과를 함께 본다.

```bash
kubectl get pods -l app=sample-hpa-app --watch
kubectl top pods -l app=sample-hpa-app
kubectl describe hpa sample-hpa-app
```

트래픽이 충분해 평균 CPU 사용률이 목표를 넘으면 `TARGETS` 값과 원하는 복제본 수가 증가할 수 있다. 부하가 줄어들면 HPA는 급격한 반복 확장을 피하기 위한 안정화 동작을 거친 뒤 Pod 수를 줄인다.

`nginx`는 아주 가벼운 요청만으로는 CPU 사용량이 크게 늘지 않을 수 있다. HPA 실습에서는 충분한 부하를 만들 수 있는 도구·애플리케이션을 준비하고, 실제 서비스에서는 CPU뿐 아니라 메모리, 초당 요청 수, 큐 길이 같은 워크로드에 맞는 지표도 검토한다.

---

## 6. CPU 외의 지표와 다중 지표도 사용할 수 있다

`autoscaling/v2`에서는 CPU·메모리뿐 아니라 애플리케이션과 외부 시스템의 지표도 HPA의 기준으로 삼을 수 있다. 다만 `Pods`, `Object`, `External` 지표를 쓰려면 Metrics Server 외에 해당 지표를 Kubernetes API로 제공하는 메트릭 어댑터가 필요하다.

| 지표 유형 | 측정 대상 | 예시 |
| --- | --- | --- |
| `Resource` | Pod의 CPU·메모리 사용량 | 평균 CPU 사용률, 평균 메모리 사용량 |
| `Pods` | 각 Pod에서 수집한 사용자 정의 지표 | Pod당 활성 연결 수 |
| `Object` | 특정 Kubernetes 객체의 지표 | Ingress의 초당 요청 수 |
| `External` | 클러스터 밖에서 수집한 지표 | 메시지 큐 길이, 외부 로드 밸런서 QPS |

여러 지표를 함께 지정할 수도 있다. HPA는 각 지표가 제안한 복제본 수 중 가장 큰 값을 선택하므로, CPU 또는 메모리 중 하나만 목표를 넘어도 스케일 아웃할 수 있다.

```yaml
metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: AverageValue
        averageValue: 500Mi
```

`Utilization`은 컨테이너 `requests` 대비 백분율을, `AverageValue`는 대상 Pod 전체의 평균 실제 사용량을 뜻한다. CPU 사용률처럼 요청량을 기준으로 판단하고 싶다면 `Utilization`을, 평균 `500Mi`처럼 절대값을 목표로 삼고 싶다면 `AverageValue`를 사용한다.

---

## 7. behavior로 확장과 축소 속도를 제어한다

지표가 짧은 시간에 오르내리면 Pod 수가 계속 변하는 플래핑(flapping)이 생길 수 있다. `behavior`에서는 스케일 아웃과 스케일 인의 속도, 안정화 시간을 별도로 제어한다.

```yaml
behavior:
  scaleUp:
    stabilizationWindowSeconds: 0
    policies:
      - type: Percent
        value: 100
        periodSeconds: 15
      - type: Pods
        value: 4
        periodSeconds: 15
    selectPolicy: Max
  scaleDown:
    stabilizationWindowSeconds: 300
    policies:
      - type: Percent
        value: 50
        periodSeconds: 60
```

위 설정은 스케일 아웃 시 15초마다 현재 복제본의 100% 또는 4개 중 더 많이 늘릴 수 있는 정책을 고른다. 반대로 스케일 인은 최근 5분의 권장값을 고려하고, 한 번에 현재 복제본의 최대 50%까지만 줄인다.

| 항목 | 역할 |
| --- | --- |
| `policies` | 일정 시간(`periodSeconds`) 동안 늘리거나 줄일 수 있는 최대 Pod 수를 정함 |
| `type: Pods` | 변경 가능한 Pod 개수를 절대값으로 지정 |
| `type: Percent` | 현재 복제본 수의 비율로 지정 |
| `selectPolicy` | 정책이 여러 개일 때 `Max`, `Min`, `Disabled` 중 선택 |
| `stabilizationWindowSeconds` | 짧은 지표 변동에 즉시 반응하지 않도록 권장값을 안정화하는 시간 |

확장은 사용자 요청 지연을 줄이기 위해 비교적 빠르게, 축소는 일시적인 부하 재증가에 대비해 더 보수적으로 설정하는 경우가 많다. 값은 애플리케이션 시작 시간과 실제 트래픽 패턴을 관찰하며 조정한다.

---

## 8. 정리

HPA는 지표가 목표보다 높으면 Pod 수를 늘리고, 낮으면 줄이는 자동 확장 기능이다. CPU 사용률 기반 HPA에서는 `requests.cpu`가 사용률의 기준이므로 대상 컨테이너에 요청량을 지정해야 한다.

HPA가 새 Pod를 만들더라도 Pod를 배치할 노드 자리가 없을 수 있다. 다음 글에서는 이때 Pending Pod를 계기로 노드 수를 조절하는 Cluster Autoscaler를 살펴본다.

---

## 참고 자료

* [Kubernetes 문서 - Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
* [Kubernetes 문서 - 리소스 메트릭 파이프라인](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/)
