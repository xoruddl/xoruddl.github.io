---
layout: post
title: "Kubernetes (12) - ReplicaSet으로 원하는 Pod 수 유지하기"
date: 2026-08-30 00:54:22 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "pod", "replicaset", "replicas", "label", "selector", "deployment", "쿠버네티스"]
---

Pod는 노드 장애, 애플리케이션 오류, 실수로 인한 삭제처럼 여러 이유로 사라질 수 있다. ReplicaSet은 **지정한 수의 Pod가 계속 실행되도록 유지**하는 컨트롤러다. Pod 수가 부족하면 새 Pod를 만들고, 많으면 일부 Pod를 제거한다.

이번 글에서는 NGINX Pod 세 개를 유지하는 ReplicaSet을 만들고, Pod 삭제·스케일 조정·컨트롤러만 삭제하는 동작을 확인한다.

## ReplicaSet이 관리하는 것

ReplicaSet은 라벨 셀렉터로 관리 대상을 찾고, 원하는 상태와 실제 상태를 계속 비교한다.

| 항목 | 역할 |
| --- | --- |
| `spec.replicas` | 유지할 Pod의 목표 개수 |
| `spec.selector` | ReplicaSet이 관리할 Pod를 고르는 라벨 조건 |
| `spec.template` | 부족한 Pod를 새로 만들 때 사용할 Pod 템플릿 |

ReplicaSet은 `selector`와 일치하는 Pod가 목표 수보다 적으면 `template`으로 Pod를 생성한다. 반대로 목표 수보다 많으면 선택된 Pod 일부를 종료해 수를 맞춘다.

일반적인 애플리케이션 배포에서는 ReplicaSet을 직접 만들기보다 Deployment를 사용한다. Deployment가 ReplicaSet을 생성·교체하면서 롤링 업데이트와 롤백을 제공하기 때문이다. 다만 ReplicaSet의 동작 원리를 이해하면 Deployment가 Pod 수를 유지하는 방식도 자연스럽게 이해할 수 있다.

## NGINX ReplicaSet 정의하기

다음 매니페스트는 `app: webui` 라벨을 가진 NGINX Pod 세 개를 유지한다.

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: rs-nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: webui
  template:
    metadata:
      name: nginx-pod
      labels:
        app: webui
    spec:
      containers:
        - name: nginx-container
          image: nginx:1.14
```

여기서 가장 중요한 부분은 `selector.matchLabels`와 `template.metadata.labels`다. 둘 모두 `app: webui`를 사용해야 ReplicaSet이 자신이 만든 Pod를 선택할 수 있다. `apps/v1` ReplicaSet에서는 이 둘이 일치하지 않으면 매니페스트가 거부된다.

ReplicationController가 같은 값인지 비교하는 방식의 셀렉터를 사용했다면, ReplicaSet은 `matchLabels`뿐 아니라 `matchExpressions`를 이용한 집합 기반 조건도 표현할 수 있다.

## matchExpressions로 선택 조건 확장하기

`matchLabels`의 `app: webui`는 `app` 라벨 값이 정확히 `webui`인 Pod를 선택한다. 이는 아래처럼 값이 하나인 `In` 조건과 같은 의미다.

```yaml
matchExpressions:
  - key: app
    operator: In
    values: [webui]
```

`matchExpressions`에서는 다음 네 연산자를 사용할 수 있다.

| 연산자 | 선택 조건 | `values` 설정 |
| --- | --- | --- |
| `In` | 라벨 키가 존재하고 값이 목록 중 하나일 때 | 하나 이상 필요 |
| `NotIn` | 라벨 키가 없거나, 값이 목록에 없을 때 | 하나 이상 필요 |
| `Exists` | 라벨 키가 존재할 때 | 작성하지 않음 |
| `DoesNotExist` | 라벨 키가 없을 때 | 작성하지 않음 |

예를 들어 `app: webui`이면서 `tier`가 `frontend` 또는 `api`인 Pod만 관리하고, `environment: dev`인 Pod는 제외하려면 다음처럼 작성할 수 있다.

```yaml
selector:
  matchLabels:
    app: webui
  matchExpressions:
    - key: tier
      operator: In
      values: [frontend, api]
    - key: environment
      operator: NotIn
      values: [dev]
```

`matchLabels`와 `matchExpressions`의 모든 조건은 **AND**로 결합된다. 따라서 위 예시의 Pod 템플릿에는 적어도 `app: webui`와 `tier: frontend` 또는 `tier: api` 라벨이 있어야 한다. 예를 들어 `tier: frontend`를 선택했다면 템플릿 라벨도 다음처럼 맞춘다.

```yaml
template:
  metadata:
    labels:
      app: webui
      tier: frontend
```

한 네임스페이스에서 서로 다른 ReplicaSet의 셀렉터 범위가 겹치지 않도록 설계해야 한다. 겹치는 범위의 Pod를 여러 ReplicaSet이 관리하려 하면 원하는 복제 수를 안정적으로 판단할 수 없다.

## 생성 결과 확인하기

매니페스트를 `rs-nginx.yaml`로 저장한 뒤 적용한다.

```bash
kubectl apply -f rs-nginx.yaml
kubectl get replicaset
kubectl get rs
kubectl get pod --show-labels
```

실행 결과는 다음처럼 확인할 수 있다.

```text
NAME       DESIRED   CURRENT   READY   AGE
rs-nginx   3         3         3       62s

NAME             READY   STATUS    RESTARTS   AGE   LABELS
rs-nginx-5np49   1/1     Running   0          34s   app=webui
rs-nginx-n5klt   1/1     Running   0          34s   app=webui
rs-nginx-r6z8f   1/1     Running   0          34s   app=webui
```

`DESIRED`는 선언한 목표 Pod 수, `CURRENT`는 ReplicaSet이 관리하는 현재 Pod 수, `READY`는 준비 상태인 Pod 수다. 생성된 Pod 이름 뒤에는 ReplicaSet이 붙인 임의의 접미사가 붙는다.

## Pod가 삭제되면 자동으로 복구된다

관리 중인 Pod 하나를 삭제해 본다.

```bash
kubectl delete pod rs-nginx-5np49
kubectl get pods -l app=webui --watch
```

삭제 직후에는 Pod 수가 두 개가 되지만, ReplicaSet은 `replicas: 3` 상태를 만족하기 위해 새 Pod 하나를 생성한다. 즉 ReplicaSet은 특정 Pod 이름을 보존하는 것이 아니라, **셀렉터에 일치하는 정상 Pod의 개수**를 보존한다.

Pod가 `Pending` 상태에 머무르거나 노드 자원이 부족하다면 ReplicaSet은 Pod를 생성해도 `READY`가 목표에 도달하지 않을 수 있다. 이때는 ReplicaSet 자체보다 스케줄링 이벤트와 노드 자원을 함께 확인해야 한다.

```bash
kubectl describe rs rs-nginx
kubectl get events --sort-by=.lastTimestamp
```

## replicas 값으로 Pod 수 조정하기

명령어로 목표 복제 수를 두 개로 바꿀 수 있다.

```bash
kubectl scale rs rs-nginx --replicas=2
kubectl get rs
kubectl get pods -l app=webui
```

ReplicaSet은 `DESIRED` 값을 2로 바꾸고, 기존 세 Pod 중 하나를 종료해 두 개만 남긴다. 이 변경을 선언적으로 관리하려면 매니페스트의 `spec.replicas`를 수정한 뒤 다시 `kubectl apply`를 실행하면 된다.

```yaml
spec:
  replicas: 2
```

## ReplicaSet만 삭제하고 Pod는 남기기

기본적으로 ReplicaSet을 삭제하면 ReplicaSet이 소유한 Pod도 함께 삭제된다. 컨트롤러만 제거하고 Pod는 남기려면 orphan 전파 정책을 사용한다.

```bash
kubectl delete rs rs-nginx --cascade=orphan
kubectl get rs
kubectl get pods -l app=webui
```

명령 실행 후 ReplicaSet은 사라지지만 기존 Pod는 `Running` 상태로 남는다. 다만 이제는 Pod를 삭제해도 새 Pod를 만들어 줄 컨트롤러가 없으므로 Pod 수가 자동으로 복구되지 않는다.

과거 예시에서 사용하던 `--cascade=false`는 더 이상 권장되지 않는다. 동일한 의도를 명확하게 표현하는 `--cascade=orphan`을 사용한다. 나중에 같은 셀렉터를 가진 ReplicaSet을 만들면 남아 있는 Pod를 채택할 수 있으므로, 운영 환경에서는 라벨 범위를 신중하게 설계해야 한다.

## ReplicationController, ReplicaSet, Deployment 비교

| 리소스 | Pod 수 유지 | 셀렉터 | 배포 전략 |
| --- | --- | --- | --- |
| ReplicationController | 가능 | 동등성 기반 조건 | 직접 관리 필요 |
| ReplicaSet | 가능 | 동등성·집합 기반 조건 | 직접 관리 필요 |
| Deployment | ReplicaSet을 통해 가능 | ReplicaSet으로 관리 | 롤링 업데이트, 롤백 지원 |

새로운 애플리케이션을 배포할 때는 보통 Deployment를 선택한다. ReplicaSet은 그 아래에서 원하는 수의 Pod를 유지하는 역할을 맡는다. 반면 업데이트 전략을 별도로 제어해야 하거나 ReplicaSet의 상태 유지 동작을 학습할 때는 직접 정의해 볼 수 있다.

## 마무리

ReplicaSet은 라벨 셀렉터와 Pod 템플릿을 바탕으로 원하는 수의 Pod를 유지한다. `replicas`로 목표 개수를 선언하고, Pod를 삭제하거나 스케일을 조정해 보면 선언한 상태를 맞추려는 컨트롤러의 동작을 확인할 수 있다. Deployment를 사용할 때도 내부적으로 ReplicaSet이 이 역할을 수행한다는 점을 기억해 두자.

## 참고 자료

- [ReplicaSet | Kubernetes 공식 문서](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/)
- [Labels and Selectors | Kubernetes 공식 문서](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/)
