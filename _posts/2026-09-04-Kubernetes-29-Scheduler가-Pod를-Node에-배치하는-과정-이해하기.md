---
layout: post
title: "Kubernetes (29) - Scheduler가 Pod를 Node에 배치하는 과정 이해하기"
date: 2026-09-04 12:29:00 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "scheduler", "scheduling", "node", "pending", "requests", "쿠버네티스"]
---

Deployment 같은 컨트롤러가 Pod를 생성해도 어느 Node에서 실행할지는 아직 정해지지 않았다. 기본 스케줄러인 `kube-scheduler`는 Node가 지정되지 않은 Pod를 발견하고, 조건을 만족하는 Node 중 적합한 곳을 선택해 연결한다.

앞에서 배운 CPU·메모리 `requests`는 이때 중요한 배치 기준이 된다. 이번 글에서는 Pod가 Node에 배치되는 과정과 `Pending` 상태가 계속될 때 확인할 항목을 살펴본다.

---


## 1. Scheduler는 Pod를 실행하지 않는다

스케줄러의 역할은 Pod를 실행할 Node를 선택하는 것이다. 실제로 컨테이너를 실행하는 주체는 선택된 Node의 kubelet이다.

```text
컨트롤러가 Pod 생성
        ↓
Scheduler가 실행 가능한 Node 선택
        ↓
Pod와 Node를 Binding
        ↓
선택된 Node의 kubelet이 컨테이너 실행
```

Pod가 어느 Node에 배치됐는지는 다음 명령으로 확인한다.

```bash
kubectl get pods -o wide
kubectl get pod <pod-name> -o jsonpath='{.spec.nodeName}{"\n"}'
```

아직 배치되지 않은 Pod는 `spec.nodeName`이 비어 있고 일반적으로 `Pending` 상태로 나타난다.

---

## 2. 먼저 실행할 수 없는 Node를 제외한다

스케줄러는 필터링 단계에서 Pod의 조건을 만족하지 못하는 Node를 제외한다. 남은 Node를 실행 가능한 Node(Feasible Node)라고 한다.

대표적인 판단 기준은 다음과 같다.

| 조건 | 확인하는 내용 |
| --- | --- |
| 리소스 요청량 | Node에 Pod의 CPU·메모리 `requests`를 수용할 여유가 있는가 |
| Node Selector·Affinity | Pod가 요구한 Node Label 조건을 만족하는가 |
| Taint와 Toleration | Pod가 Node의 Taint를 허용하는가 |
| 볼륨 조건 | 요청한 볼륨을 해당 Node에서 사용할 수 있는가 |
| 포트 충돌 | `hostPort`처럼 Node 자원을 독점하는 조건이 충돌하지 않는가 |

한 개의 Node도 필터를 통과하지 못하면 Pod는 배치되지 않고 대기한다. 컨테이너 이미지 다운로드나 애플리케이션 오류보다 먼저, 스케줄링 조건 자체를 확인해야 한다.

---

## 3. requests는 실제 사용량이 아니라 예약 기준이다

스케줄러는 순간적인 실제 CPU·메모리 사용량이 아니라 Pod에 선언된 `requests`를 기준으로 Node의 수용 가능 여부를 판단한다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: resource-demo
spec:
  containers:
    - name: nginx
      image: nginx:1.27
      resources:
        requests:
          cpu: 500m
          memory: 256Mi
        limits:
          cpu: "1"
          memory: 512Mi
```

이 Pod는 스케줄링 관점에서 CPU `500m`와 메모리 `256Mi`를 요청한다. 현재 사용량이 거의 없더라도 Node에 남은 예약 가능 자원이 이보다 작으면 배치할 수 없다.

Node에 예약된 요청량은 다음 명령의 `Allocated resources`에서 확인한다.

```bash
kubectl describe node <node-name>
```

`kubectl top node`는 현재 사용량을 보여 주고 `describe node`의 요청량 합계는 스케줄링 기준을 보여 준다. 두 값을 같은 의미로 해석하지 않아야 한다.

---

## 4. 가능한 Node의 점수를 계산한다

필터링을 통과한 Node가 여러 개라면 스케줄러는 점수화 단계에서 각 Node의 적합도를 비교한다. 활성화된 스케줄링 플러그인은 자원 분포, Pod 배치 관계 등 여러 기준으로 점수를 계산한다.

```text
전체 Node
   ↓ Filter
실행 가능한 Node 집합
   ↓ Score
가장 적합한 Node 선택
   ↓ Bind
Pod.spec.nodeName에 결과 반영
```

점수가 같을 때는 그중 하나를 선택한다. 기본 설정의 세부 점수 계산을 외우기보다, 필터링은 실행 불가능한 Node를 제거하고 점수화는 가능한 Node 사이의 우선순위를 정한다는 흐름을 이해하는 것이 중요하다.

---

## 5. Node Label로 배치 위치 제한하기

특정 하드웨어나 용도를 가진 Node에서만 Pod를 실행하려면 먼저 Node에 Label을 붙인다.

```bash
kubectl label node <node-name> workload=web
kubectl get nodes --show-labels
```

Pod의 `nodeSelector`에서 같은 조건을 요구한다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-node-selector
spec:
  nodeSelector:
    workload: web
  containers:
    - name: nginx
      image: nginx:1.27
```

```bash
kubectl apply -f nginx-node-selector.yaml
kubectl get pod nginx-node-selector -o wide
```

조건을 만족하는 Node가 없으면 Pod는 `Pending`으로 남는다. `nodeSelector`보다 복잡한 선호·필수 조건은 Node Affinity로 표현할 수 있지만, 먼저 Label과 단순한 선택 조건의 연결을 확실히 이해하는 것이 좋다.

---

## 6. Pending Pod 진단하기

배치되지 않는 원인은 Pod 이벤트에 가장 구체적으로 나타난다.

```bash
kubectl get pods --field-selector status.phase=Pending
kubectl describe pod <pending-pod-name>
kubectl get events --sort-by=.lastTimestamp
```

`describe`의 `Events`에서 `FailedScheduling` 메시지를 확인한다.

| 메시지에서 확인할 표현 | 점검할 항목 |
| --- | --- |
| `Insufficient cpu` | CPU requests와 Node의 예약 가능 CPU |
| `Insufficient memory` | 메모리 requests와 Node의 예약 가능 메모리 |
| `didn't match Pod's node affinity/selector` | Node Label과 선택 조건 |
| `untolerated taint` | Node Taint와 Pod Toleration |
| 볼륨 관련 충돌 | PVC 상태, StorageClass, 볼륨의 토폴로지 |

조건을 해결하면 스케줄러가 대기 중인 Pod를 다시 검토하므로 보통 Pod를 새로 만들 필요는 없다. 원인을 확인하지 않고 requests를 무조건 줄이면 실행 중 자원 부족으로 문제가 이동할 수 있으므로, 실제 사용량과 애플리케이션 요구량을 함께 검토한다.

---

## 7. 직접 Node를 지정하는 방식은 제한적으로 사용한다

`spec.nodeName`을 직접 지정하면 일반 스케줄러의 선택 과정을 거치지 않고 특정 Node에 연결할 수 있다. 하지만 Node 이름에 강하게 결합되고 일반적인 스케줄링 정책을 활용하기 어려우므로 특별한 목적이 아니라면 `nodeSelector`, Affinity, Taint와 Toleration을 사용한다.

DaemonSet이나 Static Pod처럼 배치 주체와 방식이 다른 워크로드도 있다. 중요한 점은 모든 Pod가 Deployment의 복제 수만으로 분산되는 것이 아니며, 실제 배치는 스케줄링 조건과 클러스터 상황에 따라 결정된다는 것이다.

---

## 8. 정리

`kube-scheduler`는 아직 Node가 정해지지 않은 Pod를 찾아 실행할 수 없는 Node를 필터링하고, 남은 Node를 점수화한 뒤 하나를 선택해 Binding한다. 실제 컨테이너 실행은 선택된 Node의 kubelet이 담당한다.

Pod가 `Pending`에 머무르면 `kubectl describe pod`의 `FailedScheduling` 이벤트부터 확인한다. 리소스 requests, Node Label 조건, Taint, 볼륨 조건을 차례로 살펴보면 배치되지 않는 이유를 찾을 수 있다. 다음 글에서는 Node의 임시 저장 공간이 부족할 때 발생할 수 있는 Pod Eviction을 다룬다.

---

## 참고 자료

* [Kubernetes 문서 - Kubernetes Scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)
* [Kubernetes 문서 - Scheduling Framework](https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/)
* [Kubernetes 문서 - Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)
