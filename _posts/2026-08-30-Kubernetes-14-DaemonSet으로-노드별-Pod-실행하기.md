---
layout: post
title: "Kubernetes (14) - DaemonSet으로 노드별 Pod 실행하기"
date: 2026-08-30 16:16:50 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "daemonset", "pod", "node", "logging", "monitoring", "rolling-update", "쿠버네티스"]
---

## 1. DaemonSet이 필요한 이유

Deployment는 원하는 개수의 Pod를 실행하지만, 어느 노드에 Pod가 배치될지는 스케줄러가 결정한다. 반면 DaemonSet은 **선택된 각 노드에 Pod 복제본 하나씩**이 실행되도록 보장하는 워크로드 리소스다.

클러스터에 새 노드가 추가되면 DaemonSet은 그 노드에도 Pod를 만들고, 노드가 제거되면 해당 Pod도 정리한다. 따라서 모든 노드에서 동작해야 하는 로그 수집기, 모니터링 에이전트, 네트워크·스토리지 구성 요소를 배포할 때 적합하다.

---

## 2. DaemonSet의 동작 방식

DaemonSet은 `replicas` 값을 사용하지 않는다. Pod의 목표 개수는 노드 수가 아니라 **조건에 맞는 노드 수**로 결정된다.

```text
DaemonSet
├── worker-1 → Pod 1개
├── worker-2 → Pod 1개
└── worker-3 → Pod 1개
```

| 상황 | DaemonSet 동작 |
| --- | --- |
| 대상 노드가 추가됨 | 새 노드에 Pod 1개 생성 |
| 대상 노드가 제거됨 | 해당 노드의 Pod 정리 |
| DaemonSet Pod가 삭제됨 | 같은 노드에 대체 Pod 생성 |
| 노드 라벨이 selector 조건에서 벗어남 | 해당 노드의 Pod 삭제 |

대표적인 사용 사례는 다음과 같다.

* 모든 노드의 로그를 수집하는 에이전트
* 노드별 메트릭을 수집하는 모니터링 에이전트
* CNI 같은 네트워크 플러그인 구성 요소
* 노드 로컬 스토리지 데몬

---

## 3. NGINX DaemonSet 매니페스트

다음 예제는 학습 목적으로 각 대상 노드에 NGINX Pod 하나를 실행한다. 실제 운영에서는 NGINX 대신 로그·모니터링 에이전트처럼 노드 단위 기능을 수행하는 컨테이너를 주로 사용한다.

```yaml
# daemonset-nginx.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: daemonset-nginx
spec:
  selector:
    matchLabels:
      app: webui
  template:
    metadata:
      labels:
        app: webui
    spec:
      containers:
        - name: nginx-container
          image: nginx:1.14
          ports:
            - containerPort: 80
```

`spec.selector.matchLabels`와 `spec.template.metadata.labels`는 반드시 일치해야 한다. DaemonSet이 생성된 뒤 `spec.selector`는 변경할 수 없으므로, 다른 컨트롤러와 겹치지 않는 라벨을 처음부터 설계해야 한다.

ReplicaSet 매니페스트와 비슷하지만 `replicas`가 없다는 점이 핵심 차이다. DaemonSet은 Pod 수를 숫자로 맞추는 대신, 대상 노드마다 하나씩 Pod를 만든다.

---

## 4. 생성과 상태 확인

매니페스트를 적용한 뒤 DaemonSet과 Pod 목록을 확인한다.

```bash
kubectl apply -f daemonset-nginx.yaml
kubectl get daemonset
kubectl get ds
kubectl get pods -o wide
```

`kubectl get ds`의 주요 열은 다음과 같다.

| 열 | 의미 |
| --- | --- |
| `DESIRED` | Pod가 실행되어야 하는 대상 노드 수 |
| `CURRENT` | DaemonSet이 생성한 현재 Pod 수 |
| `READY` | 준비 상태인 Pod 수 |
| `UP-TO-DATE` | 최신 Pod 템플릿을 사용하는 Pod 수 |
| `AVAILABLE` | 사용 가능한 Pod 수 |

`kubectl get pods -o wide`로 Pod가 어느 노드에 배치됐는지 확인한다. 대상 노드가 세 개라면 일반적으로 NGINX Pod도 세 개가 보이며, 각 Pod의 `NODE` 열이 서로 다른 노드를 가리킨다.

```bash
kubectl describe ds daemonset-nginx
```

`describe` 출력에서는 selector, 원하는·현재·준비된 Pod 수와 Pod 생성 이벤트를 확인할 수 있다.

---

## 5. 모든 노드가 아니라 대상 노드에 배치된다

DaemonSet은 기본적으로 모든 **적격 노드**에 Pod를 생성한다. 그러나 컨트롤 플레인 노드에는 보통 `NoSchedule` taint가 설정되어 있으므로, 위처럼 toleration이 없는 DaemonSet Pod는 워커 노드에만 배치될 수 있다.

컨트롤 플레인에도 로그 수집기처럼 필요한 DaemonSet을 실행하려면 Pod 템플릿에 toleration을 추가한다.

```yaml
spec:
  template:
    spec:
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          operator: Exists
          effect: NoSchedule
```

반대로 일부 노드에만 실행하고 싶다면 `nodeSelector` 또는 node affinity를 사용한다. 예를 들어 아래 설정은 `logging: enabled` 라벨이 있는 노드만 대상으로 한다.

```yaml
spec:
  template:
    spec:
      nodeSelector:
        logging: enabled
```

이 경우 노드에 라벨을 추가하면 DaemonSet이 Pod를 만들고, 라벨을 제거하면 해당 노드의 Pod를 삭제한다.

```bash
kubectl label node <노드이름> logging=enabled
kubectl label node <노드이름> logging-
```

---

## 6. Pod 삭제와 노드 추가 시 복구 동작

DaemonSet이 관리하는 Pod 하나를 삭제해 본다.

```bash
kubectl get pods -l app=webui -o wide
kubectl delete pod <daemonset이-관리하는-pod-이름>
kubectl get pods -l app=webui -o wide --watch
```

Pod가 삭제되면 DaemonSet은 해당 노드에 새 Pod를 만들어 노드당 한 개라는 상태를 다시 맞춘다. 새 워커 노드를 클러스터에 조인해도 같은 원리로 새 노드에 Pod가 자동 생성된다.

DaemonSet은 노드 장애 자체를 복구하지는 않는다. 다만 노드가 다시 정상 상태가 되거나 교체 노드가 추가되면, 대상 노드 조건에 맞는 곳에 필요한 Pod가 실행되도록 조정한다.

---

## 7. 롤링 업데이트와 롤백

DaemonSet의 기본 업데이트 전략은 `RollingUpdate`다. Pod 템플릿의 컨테이너 이미지를 변경하면 각 노드의 기존 Pod를 제어된 방식으로 교체한다.

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
```

`maxUnavailable: 1`은 업데이트 중 사용할 수 없는 DaemonSet Pod를 최대 하나로 제한한다. 노드 수가 많을 때 한꺼번에 모든 에이전트가 교체되지 않도록 하는 설정이다.

이미지를 바꾸고 롤아웃 진행 상황을 확인한다.

```bash
kubectl set image daemonset/daemonset-nginx nginx-container=nginx:1.15
kubectl rollout status daemonset/daemonset-nginx
kubectl get ds
```

수동 교체가 필요하다면 `OnDelete` 전략을 사용할 수 있다. 이 전략에서는 템플릿을 변경해도 기존 Pod가 자동으로 바뀌지 않으며, 각 기존 Pod를 직접 삭제한 뒤에야 새 템플릿의 Pod가 생성된다.

```yaml
spec:
  updateStrategy:
    type: OnDelete
```

이전 버전으로 되돌릴 때는 이력을 확인한 뒤 `rollout undo`를 사용한다.

```bash
kubectl rollout history daemonset/daemonset-nginx
kubectl rollout undo daemonset/daemonset-nginx --to-revision=1
kubectl rollout status daemonset/daemonset-nginx
```

리비전의 변경 사유를 남기려면 `kubernetes.io/change-cause` 애너테이션을 매니페스트에 직접 기록한다. 과거의 `kubectl --record` 플래그는 더 이상 사용하지 않는 편이 좋다.

---

## 8. Deployment와 DaemonSet 비교

| 구분 | Deployment | DaemonSet |
| --- | --- | --- |
| Pod 개수 기준 | `replicas`로 선언 | 대상 노드 수에 따라 결정 |
| 배치 목표 | 필요한 수만큼 애플리케이션 Pod 실행 | 각 대상 노드에 Pod 1개 실행 |
| 대표 용도 | 웹 API, 프론트엔드 같은 일반 서비스 | 로그 수집, 모니터링, 네트워크·스토리지 에이전트 |
| 노드 추가 시 | 필요에 따라 스케줄러가 배치 | 새 대상 노드에 자동으로 Pod 생성 |
| 업데이트 | ReplicaSet을 교체하며 롤링 업데이트 | 노드별 Pod를 순차적으로 교체 |

일반 서비스의 트래픽 처리량을 늘리기 위해 Pod 수를 조절해야 한다면 Deployment가 적합하다. 반면 각 노드가 공통으로 갖춰야 할 기능을 제공해야 한다면 DaemonSet을 선택한다.

---

## 9. 정리

DaemonSet은 모든 노드 또는 라벨·affinity·toleration 조건을 만족하는 일부 노드에 Pod를 하나씩 배치한다. 노드 추가와 Pod 삭제에 대응해 자동으로 Pod를 생성하므로 노드 단위 로그 수집, 모니터링, 네트워킹 같은 작업에 적합하다.

Pod 수를 `replicas`로 지정하지 않는다는 점, 컨트롤 플레인 taint 때문에 대상 노드가 달라질 수 있다는 점, 그리고 `RollingUpdate`와 `OnDelete` 전략의 차이를 기억해 두면 DaemonSet을 안전하게 운영할 수 있다.

---

## 참고 자료

* [DaemonSet | Kubernetes 공식 문서](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/)
* [Perform a Rolling Update on a DaemonSet | Kubernetes 공식 문서](https://kubernetes.io/docs/tasks/manage-daemon/update-daemon-set/)
* [Perform a Rollback on a DaemonSet | Kubernetes 공식 문서](https://kubernetes.io/docs/tasks/manage-daemon/rollback-daemon-set/)
