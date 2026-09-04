---
layout: post
title: "Kubernetes (29) - requests와 limits로 Pod 리소스 관리하기"
date: 2026-09-04 08:39:43 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "resources", "requests", "limits", "cpu", "memory", "scheduling", "쿠버네티스"]
---

하나의 Kubernetes 노드에는 여러 Pod가 함께 실행된다. 아무 기준 없이 CPU와 메모리를 사용하게 두면 특정 Pod가 자원을 과도하게 사용하거나, 새 Pod가 배치될 자리가 없는데도 문제를 늦게 발견할 수 있다.

`requests`와 `limits`는 컨테이너가 사용할 CPU·메모리의 기준을 선언하는 설정이다. 처음에는 `requests`를 **Pod가 들어갈 자리를 예약하는 값**, `limits`를 **컨테이너가 넘지 않도록 정한 상한**으로 이해하면 좋다.

---

## 1. CPU와 메모리 단위를 먼저 구분한다

Kubernetes는 컨테이너별로 CPU와 메모리 요청량·제한량을 지정할 수 있다. CPU는 클럭 속도가 아니라 CPU 처리량의 단위로 표현한다.

| 리소스 | 예시 | 의미 |
| --- | --- | --- |
| CPU | `1`, `500m`, `250m` | `1`은 CPU 1개, `1000m`은 `1` CPU, `500m`은 그 절반 |
| 메모리 | `512Mi`, `1Gi` | 바이트 단위의 메모리 용량 |

`m`은 millicore의 약자로 `1000m = 1`이다. 예를 들어 `250m`은 CPU 0.25개를 요청한다. `3GHz` 같은 CPU의 물리적인 클럭 속도와 `1 CPU`는 같은 뜻이 아니다.

메모리는 혼동을 줄이기 위해 `Mi`, `Gi`처럼 2진 접두사를 사용하는 편이 좋다. `512Mi`는 약 512 MiB의 메모리를 뜻한다.

---

## 2. requests는 배치 기준, limits는 실행 중 상한이다

리소스 설정은 Pod 안의 각 컨테이너 `resources`에 작성한다.

```yaml
# sample-resources.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sample-resources
spec:
  replicas: 3
  selector:
    matchLabels:
      app: sample-resources
  template:
    metadata:
      labels:
        app: sample-resources
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          resources:
            requests:
              # 스케줄러가 이 Pod를 배치할 때 확보해야 하는 양
              cpu: 250m
              memory: 256Mi
            limits:
              # 컨테이너가 사용할 수 있는 상한
              cpu: 500m
              memory: 512Mi
```

두 값의 역할은 다음과 같다.

| 설정 | 언제 사용되는가 | 핵심 동작 |
| --- | --- | --- |
| `requests` | Pod를 노드에 배치할 때 | 노드의 남은 **할당 가능 자원**으로 요청량을 수용할 수 있는지 판단 |
| `limits.cpu` | 컨테이너가 CPU를 많이 쓰려고 할 때 | 상한을 넘는 CPU 사용을 제한해 처리 속도가 느려질 수 있음 |
| `limits.memory` | 컨테이너가 메모리를 많이 쓰려고 할 때 | 상한을 넘겨 메모리를 계속 확보하지 못하면 컨테이너가 OOM 종료될 수 있음 |

스케줄러는 실시간 CPU 사용률이 아니라 주로 `requests`의 합계를 기준으로 Pod를 배치한다. 따라서 노드에 남은 할당 가능 CPU가 `200m`인데 새 Pod가 `250m`을 요청하면, 실제 CPU 사용률이 낮아 보여도 그 노드에는 배치되지 않는다.

```bash
kubectl apply -f sample-resources.yaml
kubectl get pods
kubectl describe pod <pod-name>
```

자원이 부족해 Pod가 `Pending` 상태라면 `kubectl describe pod`의 Events에서 `Insufficient cpu` 또는 `Insufficient memory` 같은 스케줄링 실패 이유를 먼저 확인한다.

---

## 3. 한쪽만 설정하면 어떻게 될까?

학습 단계에서는 CPU와 메모리에 `requests`와 `limits`를 모두 명시하는 습관이 가장 안전하다. 둘 중 하나만 지정하면 다음과 같이 동작한다.

| 작성한 설정 | Kubernetes가 처리하는 방식 | 주의할 점 |
| --- | --- | --- |
| `requests`만 지정 | 배치는 요청량을 기준으로 하지만, 해당 리소스의 상한은 없음 | 노드에 여유가 있으면 컨테이너가 더 많은 자원을 사용할 수 있음 |
| `limits`만 지정 | 같은 리소스의 `requests`를 `limits` 값으로 복사 | 예상보다 큰 요청량으로 간주되어 Pod가 배치되지 않을 수 있음 |
| 둘 다 지정 | 배치와 실행 중 보호 기준이 분명해짐 | 실제 사용량을 관찰하며 값 조정 필요 |

예를 들어 `limits.memory: 512Mi`만 지정하면 Kubernetes는 메모리 요청도 `512Mi`로 취급한다. 반대로 요청만 `256Mi`로 지정한 컨테이너는 노드 여유가 있다면 그보다 많은 메모리를 사용할 수 있다. 메모리 사용량이 급증할 수 있는 애플리케이션이라면 한쪽만 두는 설정을 신중히 사용해야 한다.

---

## 4. 요청량보다 많은 Pod를 만들면 Pending이 된다

다음처럼 복제본 수를 늘리면, 노드의 할당 가능 자원보다 모든 Pod의 `requests` 합계가 커지는 상황을 확인할 수 있다.

```bash
kubectl scale deployment sample-resources --replicas=20
kubectl get pods
```

일부 Pod가 `Pending`이면 다음 명령으로 원인을 확인한다.

```bash
kubectl describe pod <pending-pod-name>
kubectl describe node <node-name>
```

`describe node`의 `Allocated resources`는 각 노드에 예약된 요청량을 보여 준다. 이 값은 실제 사용량 그래프가 아니라, 스케줄러가 이미 배치한 Pod의 요청량을 이해하는 데 유용하다.

Pod에 컨테이너가 여러 개라면 일반 컨테이너의 요청량을 합쳐 Pod의 필요량을 계산한다. 초기화 컨테이너가 있다면 초기화 컨테이너 중 가장 큰 요청량도 함께 고려한다. 따라서 사이드카나 초기화 컨테이너를 추가할 때도 리소스 설정을 빠뜨리지 않아야 한다.

---

## 5. 처음에는 작게 시작하고 측정해서 조정한다

리소스 값은 한 번 정하면 끝나는 숫자가 아니다. 부하 테스트와 모니터링 결과를 바탕으로 조금씩 조정해야 한다.

1. 개발·테스트 환경에서 현실적인 트래픽을 재현한다.
2. CPU 사용량, 메모리 최고 사용량, OOM 종료 여부를 확인한다.
3. 정상 부하에서 필요한 양을 `requests`로 정한다.
4. 갑작스러운 사용량 증가를 감안해 `limits`를 정하고 다시 검증한다.

CPU 제한은 성능 저하로 나타날 수 있고, 메모리 제한은 OOM 종료로 이어질 수 있다. 따라서 단순히 큰 값을 넣기보다, 애플리케이션의 실제 특성과 노드 수용량을 함께 봐야 한다.

---

## 6. 정리

`requests`는 스케줄러가 Pod를 배치할 때 필요한 최소 자원으로 보고, `limits`는 컨테이너가 실행 중 사용할 수 있는 상한으로 이해하면 된다. CPU는 `m` 단위를, 메모리는 `Mi`·`Gi` 단위를 사용하면 매니페스트를 읽기 쉽다.

---

## 참고 자료

* [Kubernetes 문서 - Pod와 컨테이너의 리소스 관리](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
* [Kubernetes 문서 - CPU 리소스 할당](https://kubernetes.io/docs/tasks/configure-pod-container/assign-cpu-resource/)
* [Kubernetes 문서 - 메모리 리소스 할당](https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/)
