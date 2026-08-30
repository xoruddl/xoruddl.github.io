---
layout: post
title: "Kubernetes (13) - Deployment로 롤링 업데이트와 롤백 관리하기"
date: 2026-08-30 15:17:31 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "deployment", "replicaset", "pod", "rolling-update", "rollback", "쿠버네티스"]
---

## 1. Deployment란?

Deployment는 상태를 유지하지 않는 애플리케이션을 선언적으로 배포하고 업데이트하기 위한 워크로드 리소스다. 원하는 Pod 템플릿과 복제본 수를 선언하면 Deployment가 ReplicaSet을 만들고, ReplicaSet이 실제 Pod 수를 유지한다.

ReplicaSet을 직접 사용하면 Pod 수는 유지할 수 있지만, 새 이미지로 교체할 때 기존 Pod를 어떤 속도로 바꿀지와 이전 버전으로 되돌릴 방법을 직접 관리해야 한다. Deployment는 이 과정을 제어된 속도로 수행하는 롤링 업데이트와 배포 이력 기반의 롤백 기능을 제공한다.

---

## 2. Deployment, ReplicaSet, Pod의 관계

Deployment를 생성하면 다음과 같은 관리 관계가 만들어진다.

```text
Deployment
└── ReplicaSet
    └── Pod × replicas
```

실습에서 `kubectl get deploy,rs,pod`를 실행한 결과는 다음과 같다.

```text
NAME                            READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/deploy-nginx    3/3     3            3           2m52s

NAME                                      DESIRED   CURRENT   READY   AGE
replicaset.apps/deploy-nginx-745577c69    3         3         3       2m52s

NAME                                READY   STATUS    RESTARTS   AGE
pod/deploy-nginx-745577c69-fztgn    1/1     Running   0          2m52s
pod/deploy-nginx-745577c69-jjxkr    1/1     Running   0          2m52s
pod/deploy-nginx-745577c69-krc7g    1/1     Running   0          2m52s
```

`deploy-nginx` Deployment가 `deploy-nginx-745577c69` ReplicaSet을 만들고, 그 ReplicaSet이 세 개의 Pod를 생성한 모습이다. ReplicaSet 이름과 Pod 이름에 붙은 해시는 Pod 템플릿을 구분하기 위한 값이다. Pod 템플릿을 변경해 새 배포가 시작되면 Deployment는 새 해시를 가진 ReplicaSet을 만들고, 이전 ReplicaSet의 Pod를 점진적으로 줄인다.

| 리소스 | 책임 |
| --- | --- |
| Deployment | 배포 전략, 새 ReplicaSet 생성, 롤백 이력 관리 |
| ReplicaSet | 지정한 개수의 Pod 유지 |
| Pod | 컨테이너를 실제로 실행 |

Deployment가 소유한 ReplicaSet은 직접 수정하거나 삭제하지 않는 것이 좋다. 원하는 상태는 Deployment 매니페스트에서 관리해야 한다.

---

## 3. NGINX Deployment 매니페스트

다음 매니페스트는 NGINX 1.15를 실행하는 Pod 세 개를 배포한다.

```yaml
# deploy-nginx.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: deploy-nginx
  annotations:
    kubernetes.io/change-cause: "nginx version 1.15"
spec:
  progressDeadlineSeconds: 600
  revisionHistoryLimit: 10
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 25%
  replicas: 3
  selector:
    matchLabels:
      app: webui
  template:
    metadata:
      labels:
        app: webui
    spec:
      containers:
        - name: web
          image: nginx:1.15
          ports:
            - containerPort: 80
```

`spec.selector.matchLabels`와 `spec.template.metadata.labels`는 반드시 일치해야 한다. `apps/v1` Deployment에서 selector는 생성 후 변경할 수 없으므로, 처음부터 다른 컨트롤러와 겹치지 않는 라벨을 설계하는 것이 중요하다.

주요 필드는 다음과 같다.

| 필드 | 예제 값 | 의미 |
| --- | --- | --- |
| `replicas` | `3` | 유지할 Pod 수 |
| `strategy.type` | `RollingUpdate` | 기존 Pod와 새 Pod를 점진적으로 교체하는 전략 |
| `maxSurge` | `25%` | 목표 수를 초과해 일시적으로 만들 수 있는 최대 Pod 수 |
| `maxUnavailable` | `25%` | 업데이트 중 사용할 수 없어도 되는 최대 Pod 수 |
| `progressDeadlineSeconds` | `600` | 배포 진행이 멈췄다고 보고할 때까지 기다리는 시간(초) |
| `revisionHistoryLimit` | `10` | 롤백을 위해 보관할 이전 ReplicaSet 수 |

복제본이 3개일 때 `maxSurge: 25%`는 올림되어 1개, `maxUnavailable: 25%`는 내림되어 0개로 계산된다. 따라서 이 설정에서는 업데이트 중 최대 4개의 Pod가 잠시 실행될 수 있고, 새 Pod가 준비되기 전에는 기존 Pod를 사용할 수 없는 상태로 줄이지 않는다.

---

## 4. 생성과 상태 확인

매니페스트를 적용하고 Deployment, ReplicaSet, Pod를 함께 확인한다.

```bash
kubectl apply -f deploy-nginx.yaml
kubectl get deploy,rs,pod
```

Deployment 행의 각 열은 다음과 같이 읽는다.

| 열 | 의미 |
| --- | --- |
| `READY` | 준비된 Pod 수 / 원하는 Pod 수 |
| `UP-TO-DATE` | 최신 Pod 템플릿을 사용하는 Pod 수 |
| `AVAILABLE` | 서비스 가능한 Pod 수 |

롤아웃이 끝날 때까지 기다리거나, 현재 배포 상태를 확인하려면 `kubectl rollout status`를 사용한다.

```bash
kubectl rollout status deployment/deploy-nginx
kubectl describe deployment deploy-nginx
```

`describe` 출력에서는 현재 ReplicaSet, 배포 전략, 복제본 상태와 이벤트를 확인할 수 있다. 이미지 풀 실패나 Pod가 Ready 상태가 되지 않는 문제도 이 이벤트에서 먼저 확인하는 편이 좋다.

---

## 5. 이미지 변경으로 롤링 업데이트하기

컨테이너 이미지처럼 `spec.template` 내부의 값이 변경되면 Deployment는 새 리비전을 만든다. 아래 명령은 `web` 컨테이너의 이미지를 NGINX 1.16으로 변경한다.

```bash
kubectl set image deployment/deploy-nginx web=nginx:1.16
kubectl rollout status deployment/deploy-nginx
kubectl get rs
```

업데이트가 시작되면 새 ReplicaSet의 Pod 수는 늘어나고 이전 ReplicaSet의 Pod 수는 줄어든다. `maxSurge`와 `maxUnavailable` 값이 이 교체 속도와 가용성 범위를 결정한다.

매니페스트를 Git으로 관리한다면 YAML의 이미지와 변경 사유를 함께 수정한 뒤 적용하는 방식이 재현하기 쉽다.

```yaml
metadata:
  annotations:
    kubernetes.io/change-cause: "nginx version 1.16"
spec:
  template:
    spec:
      containers:
        - name: web
          image: nginx:1.16
```

```bash
kubectl apply -f deploy-nginx.yaml
```

`kubernetes.io/change-cause` 애너테이션은 `kubectl rollout history`의 변경 사유에 표시할 수 있다. 과거에 이 값을 자동으로 기록하던 `--record` 플래그는 더 이상 사용하지 않는 편이 좋다.

> `replicas`만 변경하는 스케일 작업은 새 리비전을 만들지 않는다. 새 리비전은 컨테이너 이미지나 라벨처럼 Pod 템플릿이 변경될 때 생성된다.

---

## 6. 배포 이력 확인과 롤백

새 버전에서 문제가 발생하면 먼저 배포 이력과 특정 리비전의 내용을 확인한다.

```bash
kubectl rollout history deployment/deploy-nginx
kubectl rollout history deployment/deploy-nginx --revision=1
```

직전 리비전으로 되돌릴 때는 다음 명령을 사용한다.

```bash
kubectl rollout undo deployment/deploy-nginx
kubectl rollout status deployment/deploy-nginx
```

특정 리비전으로 되돌리고 싶다면 `--to-revision` 옵션을 지정한다.

```bash
kubectl rollout undo deployment/deploy-nginx --to-revision=1
```

롤백도 새로운 롤아웃으로 처리된다. 따라서 완료 후에는 `kubectl rollout status`와 `kubectl get deploy,rs,pod`로 최신 Pod가 의도한 이미지와 상태인지 확인해야 한다.

`revisionHistoryLimit: 10`은 이전 ReplicaSet을 최대 10개까지 남겨 롤백할 수 있게 한다. 값을 `0`으로 설정하면 이전 리비전이 정리되어 새 롤아웃을 되돌릴 수 없으므로 주의해야 한다.

---

## 7. 롤아웃을 일시 중지하고 재개하기

이미지, 리소스 제한 등 Pod 템플릿의 여러 항목을 한 번에 변경하고 싶을 때는 롤아웃을 잠시 멈출 수 있다.

```bash
kubectl rollout pause deployment/deploy-nginx

# 필요한 Pod 템플릿 변경 수행
kubectl set image deployment/deploy-nginx web=nginx:1.17

kubectl rollout resume deployment/deploy-nginx
kubectl rollout status deployment/deploy-nginx
```

일시 중지 상태에서는 Pod 템플릿을 바꿔도 새 ReplicaSet을 만들지 않는다. `resume`을 실행하면 누적된 변경을 반영해 롤아웃이 시작된다. 단, 일시 중지한 Deployment는 재개하기 전까지 롤백할 수 없다.

---

## 8. 정리

Deployment는 ReplicaSet과 Pod를 계층적으로 관리하며, 원하는 Pod 수 유지뿐 아니라 변경된 Pod 템플릿을 안전하게 배포하는 역할을 맡는다. `kubectl get deploy,rs,pod` 명령을 사용하면 이 관리 관계와 각 리소스의 상태를 한 번에 확인할 수 있다.

이미지 변경은 새 ReplicaSet을 만드는 롤링 업데이트를 시작하고, `maxSurge`·`maxUnavailable`은 업데이트 중 추가 Pod 수와 가용성 수준을 조절한다. 문제가 생기면 `kubectl rollout history`, `kubectl rollout undo`, `kubectl rollout status` 순서로 이력을 확인하고 이전 안정 버전으로 되돌릴 수 있다.

---

## 참고 자료

* [Deployments | Kubernetes 공식 문서](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
