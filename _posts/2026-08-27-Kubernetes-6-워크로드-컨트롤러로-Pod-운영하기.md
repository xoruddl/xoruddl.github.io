---
layout: post
title: "Kubernetes (6) - 워크로드 컨트롤러로 Pod 운영하기"
date: 2026-08-27 18:44:35 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "workload", "replicaset", "deployment", "daemonset", "statefulset", "쿠버네티스"]
---

Pod를 직접 생성하면 간단한 실습은 할 수 있지만, Pod가 사라졌을 때 원하는 개수를 복구하거나 버전을 안전하게 바꾸는 일은 직접 처리해야 한다. Kubernetes의 워크로드 컨트롤러는 선언한 상태에 맞게 Pod를 만들고 관리해 이 부담을 줄여 준다.

이번 글에서는 워크로드 리소스의 역할을 비교하고, ReplicaSet과 Deployment의 관계, DaemonSet과 StatefulSet을 선택하는 기준을 정리한다.

---

## 1. 워크로드 리소스 선택하기

워크로드는 Kubernetes에서 실행하는 애플리케이션을 뜻한다. Pod는 컨테이너를 담는 기본 단위이고, 상위 컨트롤러는 여러 Pod의 수명주기와 원하는 상태를 관리한다.

| 리소스 | 주된 목적 | 적합한 사례 |
| --- | --- | --- |
| Pod | 컨테이너를 한 번 실행 | 단순 실습, 컨트롤러가 관리하는 Pod 템플릿 |
| ReplicaSet | 지정한 수의 Pod 유지 | 보통 Deployment가 내부적으로 사용 |
| Deployment | 무상태 앱의 복제·롤링 업데이트·롤백 | 웹 API, 프런트엔드 |
| DaemonSet | 모든 또는 선택한 노드마다 Pod 하나 배치 | 로그 수집, 노드 모니터링, 네트워크 플러그인 |
| StatefulSet | 안정적인 ID와 스토리지가 필요한 Pod 관리 | 데이터베이스, 메시지 브로커 |
| Job | 완료 후 종료되는 작업 실행 | 배치 처리, 일회성 데이터 작업 |
| CronJob | 일정에 따라 Job 반복 실행 | 정기 백업, 주기적 집계 |

`ReplicationController`는 ReplicaSet 이전의 컨트롤러다. 새 리소스를 작성할 때는 더 유연한 레이블 선택자를 지원하는 ReplicaSet을 사용하며, 일반적인 애플리케이션은 ReplicaSet을 직접 만들기보다 Deployment로 관리하는 경우가 많다.

---

## 2. ReplicaSet으로 원하는 Pod 수 유지하기

ReplicaSet은 selector에 맞는 Pod 수가 `replicas`와 같도록 계속 조정한다. 노드 장애나 Pod 종료로 수가 부족해지면 Pod 템플릿을 바탕으로 새 Pod를 만든다.

```yaml
# 사용할 Kubernetes API 그룹과 버전
apiVersion: apps/v1
# 생성할 리소스 종류
kind: ReplicaSet
metadata:
  # ReplicaSet의 이름
  name: sample-rs
# ReplicaSet이 유지할 원하는 상태를 정의
spec:
  # 유지할 Pod 개수
  replicas: 3
  selector:
    # 이 label을 가진 Pod를 관리 대상으로 선택
    matchLabels:
      # 관리 대상 Pod를 구분하는 label 값
      app: sample-app
  template:
    # Pod가 부족할 때 만들 Pod의 설계도
    metadata:
      labels:
        # selector와 반드시 일치해야 하는 Pod label
        app: sample-app
    spec:
      containers:
        # 생성할 컨테이너의 이름과 이미지
        - name: nginx-container
          image: nginx
```

```bash
kubectl apply -f sample-rs.yaml
kubectl get replicasets
kubectl get pods -l app=sample-app
kubectl describe replicaset sample-rs
```

`spec.selector.matchLabels`와 `spec.template.metadata.labels`가 일치하지 않으면 ReplicaSet이 어떤 Pod를 관리해야 하는지 알 수 없으므로 API 서버가 리소스 생성을 거부한다.

```yaml
# 잘못된 예: selector와 Pod 템플릿 label 값이 다름
# ReplicaSet이 관리할 Pod를 찾는 조건
selector:
  matchLabels:
    app: sample-app
# Pod가 부족할 때 생성할 Pod의 설계도
template:
  metadata:
    labels:
      # selector의 값과 달라서 오류가 발생
      app: sample-app-fail
```

ReplicaSet이 관리하지 않는 Pod라도 selector와 일치하고 다른 컨트롤러의 소유자가 없다면 ReplicaSet이 해당 Pod를 채택할 수 있다. 반대로 이미 원하는 수만큼 Pod가 있다면, 새로 만든 일치 Pod가 생긴 직후 ReplicaSet은 수를 맞추기 위해 Pod 하나를 삭제할 수 있다. 따라서 컨트롤러가 사용하는 label은 다른 독립 Pod에 무심코 붙이지 않는 편이 안전하다.

일시적으로 Pod 수를 바꾸려면 매니페스트의 `replicas` 값을 수정해 다시 적용하거나 다음처럼 조정한다.

```bash
kubectl scale replicaset sample-rs --replicas=5
```

---

## 3. Deployment가 ReplicaSet을 관리하는 방식

Deployment는 ReplicaSet의 상위 컨트롤러다. Deployment가 Pod 템플릿과 복제 수를 선언하면, Deployment가 ReplicaSet을 만들고 ReplicaSet이 Pod 수를 유지한다.

```yaml
# Deployment 리소스에 사용할 API 버전
apiVersion: apps/v1
# ReplicaSet과 Pod의 배포를 관리하는 컨트롤러
kind: Deployment
metadata:
  # Deployment의 이름
  name: sample-deployment
spec:
  # 유지할 Pod 개수
  replicas: 3
  selector:
    # 이 label을 가진 Pod를 Deployment 관리 대상으로 선택
    matchLabels:
      app: sample-app
  template:
    # Pod가 부족하거나 새 버전을 배포할 때 사용할 Pod 설계도
    metadata:
      labels:
        # selector와 일치해야 하는 Pod label
        app: sample-app
    spec:
      containers:
        # 실행할 컨테이너 이름과 고정된 Nginx 이미지 태그
        - name: nginx-container
          image: nginx:1.27
```

```bash
kubectl apply -f sample-deployment.yaml
kubectl get deployments
kubectl get replicasets
kubectl get pods -l app=sample-app
```

`replicas`만 바꾸는 것은 기존 ReplicaSet의 크기를 조정하는 작업이다. 반면 이미지처럼 Pod 템플릿의 내용이 바뀌면 Deployment는 새 ReplicaSet을 만들고, 새 Pod를 늘리면서 이전 ReplicaSet의 Pod를 줄이는 롤링 업데이트를 수행한다.

```bash
# 컨테이너 이미지 변경으로 새 롤아웃 시작
kubectl set image deployment/sample-deployment \
  nginx-container=nginx:1.28

# 배포 진행 상태 확인
kubectl rollout status deployment/sample-deployment

# 복제 수 조정
kubectl scale deployment/sample-deployment --replicas=5
```

실제 서비스의 이미지는 `latest` 태그 대신 추적 가능한 고정 태그 또는 이미지 다이제스트를 사용하는 편이 좋다. 그래야 어떤 버전이 배포됐는지 확인하고 같은 버전을 재현하기 쉽다.

---

## 4. 배포 이력 확인, 일시 정지, 롤백

Deployment는 이전 ReplicaSet을 남겨 두어 롤백에 활용할 수 있다. 다만 `revisionHistoryLimit`을 너무 작게 설정하거나 0으로 설정하면 오래된 이력이 정리돼 원하는 시점으로 되돌릴 수 없을 수 있다.

```bash
# 변경 이력과 특정 revision의 세부 내용 확인
kubectl rollout history deployment/sample-deployment
kubectl rollout history deployment/sample-deployment --revision=2

# 직전 revision으로 롤백
kubectl rollout undo deployment/sample-deployment

# 원하는 revision으로 롤백
kubectl rollout undo deployment/sample-deployment --to-revision=2
```

여러 변경을 한 번에 준비하고 싶다면 롤아웃을 잠시 멈춘다. 일시 정지 상태에서 Pod 템플릿을 바꿔도 새 롤아웃은 시작되지 않으며, 재개할 때 변경 사항을 반영한다.

```bash
kubectl rollout pause deployment/sample-deployment
kubectl set image deployment/sample-deployment nginx-container=nginx:1.29
kubectl rollout resume deployment/sample-deployment
kubectl rollout status deployment/sample-deployment
```

---

## 5. 모든 노드에 하나씩 배치하는 DaemonSet

DaemonSet은 조건에 맞는 각 노드에 Pod 하나가 실행되도록 관리한다. 클러스터에 노드가 추가되면 해당 노드에도 Pod를 배치하고, 노드에서 Pod가 사라지면 다시 만든다.

```yaml
# DaemonSet 리소스에 사용할 API 버전
apiVersion: apps/v1
# 조건에 맞는 각 노드에 Pod 하나씩 배치하는 컨트롤러
kind: DaemonSet
metadata:
  # DaemonSet의 이름
  name: node-monitor
spec:
  selector:
    # 이 label을 가진 Pod를 DaemonSet 관리 대상으로 선택
    matchLabels:
      app: node-monitor
  template:
    # 각 노드에 만들 모니터링 Pod의 설계도
    metadata:
      labels:
        # selector와 일치해야 하는 Pod label
        app: node-monitor
    spec:
      containers:
        # 노드 메트릭을 노출할 컨테이너와 이미지
        - name: monitor
          image: prom/node-exporter
```

```bash
kubectl apply -f node-monitor-daemonset.yaml
kubectl get daemonsets
kubectl describe daemonset/node-monitor
```

DaemonSet은 일반적으로 복제 수를 직접 지정하지 않는다. 모든 노드가 아니라 일부 노드에만 실행해야 한다면 node selector, node affinity, taint와 toleration 같은 스케줄링 설정으로 대상 노드를 제한한다.

---

## 6. 안정적인 식별자가 필요한 StatefulSet

StatefulSet은 Pod마다 유지되는 순번 기반 이름과 안정적인 네트워크·스토리지 식별자가 필요한 워크로드에 사용한다. 예를 들어 `sample-statefulset-0`, `sample-statefulset-1`처럼 Pod 이름에 순번이 붙고, Pod가 다시 만들어져도 같은 순번을 유지한다.

```yaml
# StatefulSet 리소스에 사용할 API 버전
apiVersion: apps/v1
# 안정적인 Pod 이름과 스토리지를 관리하는 컨트롤러
kind: StatefulSet
metadata:
  # StatefulSet의 이름. Pod는 sample-statefulset-0처럼 생성됨
  name: sample-statefulset
spec:
  # Pod별 네트워크 ID에 사용할 Service 이름(별도 Headless Service 필요)
  serviceName: sample-statefulset
  # 생성·유지할 Pod 개수
  replicas: 3
  selector:
    # 이 label을 가진 Pod를 StatefulSet 관리 대상으로 선택
    matchLabels:
      app: sample-app
  template:
    # 각 순번 Pod에 공통으로 적용할 설계도
    metadata:
      labels:
        # selector와 일치해야 하는 Pod label
        app: sample-app
    spec:
      containers:
        # 실행할 웹 서버 컨테이너
        - name: nginx-container
          image: nginx
          volumeMounts:
            # 아래에서 만든 www PVC를 컨테이너 경로에 마운트
            - name: www
              mountPath: /usr/share/nginx/html
  # 각 Pod마다 별도의 PersistentVolumeClaim을 만드는 템플릿
  volumeClaimTemplates:
    - metadata:
        # PVC 이름. 예: www-sample-statefulset-0
        name: www
      spec:
        accessModes:
          # 한 노드에서 읽기·쓰기를 허용하는 접근 모드
          - ReadWriteOnce
        resources:
          requests:
            # Pod별로 요청할 스토리지 용량
            storage: 1Gi
```

`volumeClaimTemplates`는 각 Pod에 연결할 PersistentVolumeClaim을 만든다. 실제로 볼륨이 생성·마운트되려면 클러스터에 요청을 처리할 StorageClass와 프로비저너가 준비돼 있어야 한다.

기본 `podManagementPolicy`인 `OrderedReady`에서는 Pod를 순서대로 생성하고 준비 상태를 확인한 뒤 다음 Pod를 만든다. 독립적으로 동시에 시작해도 되는 워크로드는 `Parallel`로 지정할 수 있지만, 순서와 데이터 일관성이 필요한 시스템이라면 기본 동작을 유지하는 편이 적절하다.

---

## 7. 정리

컨트롤러 없이 만든 Pod는 단순하지만, 장애 복구와 변경 관리까지 직접 책임져야 한다. ReplicaSet은 원하는 Pod 수를 유지하고, 일반적인 무상태 애플리케이션은 ReplicaSet을 관리하는 Deployment로 배포·스케일·롤백까지 관리하는 방식이 적합하다.

노드별 에이전트에는 DaemonSet, 안정적인 이름과 스토리지가 필요한 상태 저장 애플리케이션에는 StatefulSet을 사용한다. 작업이 끝나야 하는 배치 처리에는 Job, 같은 작업을 일정에 따라 반복해야 하면 CronJob을 선택하면 된다. 먼저 애플리케이션의 상태 보존 방식과 Pod 배치 규칙을 확인하면 적합한 워크로드 리소스를 고르기 쉬워진다.
