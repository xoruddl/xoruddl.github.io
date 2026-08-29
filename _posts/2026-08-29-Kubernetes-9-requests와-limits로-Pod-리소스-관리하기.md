---
layout: post
title: "Kubernetes (9) - requests와 limits로 Pod 리소스 관리하기"
date: 2026-08-29 18:39:22 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "pod", "resources", "requests", "limits", "cpu", "memory", "쿠버네티스"]
---

여러 Pod가 하나의 노드에서 함께 실행되면 CPU와 메모리를 무제한으로 사용하려는 컨테이너가 다른 애플리케이션의 실행을 방해할 수 있다. Kubernetes는 컨테이너의 `resources.requests`와 `resources.limits`로 필요한 자원과 사용할 수 있는 상한을 선언하게 한다.

이번 글에서는 `nginx-pod-resource` 예제를 바탕으로 requests와 limits의 역할, CPU·메모리 단위, `kubectl describe pod` 출력 확인 방법, 제한을 넘었을 때의 동작을 정리한다.

---

## 1. requests와 limits란?

`requests`는 컨테이너가 실행되기 위해 필요하다고 선언하는 CPU·메모리 양이다. 스케줄러는 Pod의 모든 컨테이너 request를 합산해, 이를 수용할 수 있는 노드에만 Pod를 배치한다. 따라서 request가 노드의 남은 할당 가능 자원보다 크면 Pod는 `Pending` 상태로 남을 수 있다.

`limits`는 컨테이너가 사용할 수 있는 최대 자원량이다. request는 배치 기준이며, limit는 실행 중의 상한이라는 점이 핵심이다.

| 구분 | `requests` | `limits` |
| --- | --- | --- |
| 의미 | 스케줄링에 필요한 자원량 | 컨테이너가 사용할 수 있는 최대 자원량 |
| 주된 영향 시점 | Pod를 노드에 배치할 때 | 컨테이너가 실행되는 동안 |
| CPU | 노드 선택 기준이 됨 | 초과 사용 시 CPU 사용이 제한될 수 있음 |
| 메모리 | 노드 선택 기준이 됨 | 초과 사용이 지속되면 컨테이너가 종료될 수 있음 |

---

## 2. CPU와 메모리 단위 이해하기

CPU는 코어 수를 기준으로 표현한다. `1`은 CPU 1개를 뜻하고, `m`은 milliCPU 단위다. 따라서 `200m`은 `0.2` CPU와 같다. CPU는 절대량이므로 노드의 전체 코어 수가 달라도 `200m` 자체의 의미는 변하지 않는다.

메모리는 바이트 단위이며 보통 `Mi`, `Gi` 같은 이진 접미사를 사용한다. `250Mi`는 250 mebibyte, `500Mi`는 500 mebibyte다. `M`과 `Mi`, `G`와 `Gi`는 기준이 다르므로 운영 매니페스트에서는 의도를 명확히 하기 위해 `Mi` 또는 `Gi` 표기를 일관되게 사용하는 편이 좋다.

| 표기 | 의미 |
| --- | --- |
| `1` CPU | CPU 1개 |
| `200m` CPU | 0.2 CPU, 즉 200 milliCPU |
| `250Mi` | 250 MiB |
| `1Gi` | 1 GiB |

---

## 3. Nginx Pod에 리소스 설정하기

다음 예제의 Nginx 컨테이너는 CPU 200m·메모리 250Mi를 request로 선언하고, CPU 1개·메모리 500Mi를 limit로 선언한다. request보다 limit가 크므로, 노드에 여유가 있을 때는 일시적으로 request보다 더 많은 자원을 사용할 수 있지만 정한 상한을 넘을 수는 없다.

```yaml
# pod-nginx-resources.yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod-resource
spec:
  containers:
    - name: nginx-container
      image: nginx:1.14
      ports:
        - containerPort: 80
          protocol: TCP
      resources:
        requests:
          # 스케줄러가 노드를 고를 때 고려하는 최소 자원량
          cpu: 200m
          memory: 250Mi
        limits:
          # 컨테이너가 사용할 수 있는 상한
          cpu: 1
          memory: 500Mi
```

```bash
kubectl apply -f pod-nginx-resources.yaml
kubectl get pods
kubectl describe pod nginx-pod-resource
```

`kubectl describe pod nginx-pod-resource`의 컨테이너 정보에는 다음처럼 `Limits`와 `Requests`가 표시된다.

```text
Limits:
  cpu:     1
  memory:  500Mi
Requests:
  cpu:     200m
  memory:  250Mi
```

Pod에 컨테이너가 여러 개라면 Pod의 CPU·메모리 request와 limit는 각 컨테이너 값의 합으로 생각할 수 있다. 스케줄러는 이 합계 request를 기준으로 노드를 선택한다.

---

## 4. CPU limit와 Memory limit의 차이

CPU와 메모리는 limit 초과 시의 동작이 다르다.

CPU 사용량이 limit를 넘으려 하면 컨테이너가 즉시 종료되기보다 런타임에 의해 CPU 사용이 스로틀링될 수 있다. 예를 들어 `cpu: 1`로 제한한 컨테이너가 2 CPU를 계속 쓰려고 하면, 실제 사용할 수 있는 CPU는 대체로 1 CPU 수준으로 제한된다. 이때 애플리케이션은 실행을 유지하지만 응답 시간이 늘어날 수 있다.

메모리는 사용량이 request를 넘더라도 노드에 여유가 있으면 limit 안에서 사용할 수 있다. 하지만 limit를 넘는 메모리 사용이 지속되면 컨테이너는 종료 대상이 된다. Pod의 재시작 정책과 컨트롤러 설정에 따라 kubelet 또는 상위 컨트롤러가 컨테이너·Pod를 다시 실행할 수 있으며, 상태에는 `OOMKilled`가 나타날 수 있다.

| 상황 | CPU | 메모리 |
| --- | --- | --- |
| request 초과, limit 이하 | 여유 자원이 있으면 사용 가능 | 여유 자원이 있으면 사용 가능 |
| limit 초과 시도 | 스로틀링될 수 있음 | 종료(OOMKilled)될 수 있음 |
| 대표 증상 | 지연 증가, 처리량 감소 | 컨테이너 재시작, 오류 발생 |

따라서 메모리 limit는 실제 사용량의 급증을 고려해 충분한 여유를 두되, 너무 크게 잡아 노드에 과도한 메모리 사용을 허용하지 않도록 조정해야 한다. CPU limit는 서비스의 지연 시간에 민감한 워크로드에서 스로틀링 영향을 측정하며 설정하는 것이 좋다.

---

## 5. QoS 클래스와 설정 시 주의점

Kubernetes는 각 Pod의 CPU·메모리 request와 limit 설정에 따라 QoS(Quality of Service) 클래스를 부여한다. 위 예제는 CPU와 메모리의 request가 limit보다 작으므로 `Burstable` 클래스가 된다.

| QoS 클래스 | 조건 |
| --- | --- |
| `Guaranteed` | 모든 컨테이너에 CPU·메모리 request와 limit가 있고, 각 자원의 request와 limit가 같음 |
| `Burstable` | 최소 하나의 CPU 또는 메모리 request·limit가 설정됐지만 `Guaranteed` 조건은 충족하지 않음 |
| `BestEffort` | 모든 컨테이너에 CPU·메모리 request와 limit가 없음 |

limit만 지정하고 request를 생략하면 Kubernetes는 해당 limit와 같은 값의 request를 자동으로 설정한다. 의도치 않게 큰 request가 설정돼 Pod가 배치되지 못할 수 있으므로, 운영 환경에서는 request와 limit를 모두 명시하는 편이 이해와 관리에 유리하다.

실제 값은 추측만으로 정하지 말고 관측 데이터를 바탕으로 정한다. Metrics Server가 준비된 클러스터라면 다음 명령으로 현재 사용량을 확인할 수 있다.

```bash
kubectl top pod nginx-pod-resource
kubectl describe pod nginx-pod-resource
```

`kubectl top`이 동작하려면 Metrics Server 같은 리소스 메트릭 파이프라인이 클러스터에 설치되어 있어야 한다. 또한 네임스페이스에 `LimitRange`나 `ResourceQuota`가 있다면 기본값 또는 상한 때문에 매니페스트의 실제 적용 결과가 달라질 수 있으므로 함께 확인한다.

---

## 6. 정리

`requests`는 Pod를 어느 노드에 배치할지 판단하는 자원 기준이고, `limits`는 실행 중 컨테이너의 자원 사용 상한이다. CPU 200m과 메모리 250Mi를 request로 선언한 예제는 해당 자원을 수용할 수 있는 노드에 배치되며, 실행 중에는 CPU 1개와 메모리 500Mi를 넘지 않도록 제한된다.

CPU limit 초과는 주로 스로틀링으로 나타나는 반면, 메모리 limit 초과는 컨테이너 종료와 재시작으로 이어질 수 있다. 애플리케이션의 실제 사용량을 관측해 request는 안정적인 실행에 필요한 수준으로, limit는 장애와 노드 자원 고갈을 막을 수준으로 설정하는 것이 중요하다.

---

## 참고 자료

* [Kubernetes 문서 - Assign CPU Resources to Containers and Pods](https://kubernetes.io/docs/tasks/configure-pod-container/assign-cpu-resource/)
* [Kubernetes 문서 - Assign Memory Resources to Containers and Pods](https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/)
* [Kubernetes 문서 - Pod Quality of Service Classes](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/)
