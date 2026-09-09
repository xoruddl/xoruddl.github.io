---
layout: post
title: "Kubernetes (4) - Label과 Selector로 Kubernetes 리소스 연결하기"
date: 2026-08-23 12:04:00 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "label", "selector", "annotation", "pod", "쿠버네티스"]
---

앞에서 Pod를 만들고 조회할 때는 리소스 이름을 사용했다. 하지만 같은 애플리케이션의 Pod가 여러 개로 늘어나거나 새 Pod로 교체되면 각각의 이름을 직접 관리하기 어렵다. Kubernetes는 Label로 리소스에 식별 정보를 붙이고, Selector로 조건에 맞는 리소스 집합을 찾는다.

이 연결 방식은 뒤에서 배울 ReplicaSet, Deployment, Service의 공통 기반이다. 이번 글에서는 Label을 붙이고 조회하는 방법부터 Selector가 컨트롤러와 Service를 연결하는 방식까지 살펴본다.

---


## 1. Label은 리소스를 분류하는 키와 값이다

Label은 Pod 같은 Kubernetes 오브젝트의 `metadata.labels`에 기록하는 키와 값이다. 하나의 리소스에 여러 Label을 붙일 수 있고, 같은 Label을 여러 리소스가 공유할 수도 있다.

```yaml
# pod-label.yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-dev
  labels:
    app: nginx
    environment: dev
    tier: frontend
spec:
  containers:
    - name: nginx
      image: nginx:1.27
```

이 예제에서 `app`, `environment`, `tier`는 Label의 키이고 `nginx`, `dev`, `frontend`는 값이다. Label은 이름처럼 하나의 리소스를 고유하게 구분하기보다, 공통된 특징을 가진 리소스를 묶는 데 사용한다.

매니페스트를 적용하고 Label을 함께 조회한다.

```bash
kubectl apply -f pod-label.yaml
kubectl get pods --show-labels
kubectl get pod nginx-dev -L app,environment,tier
```

`--show-labels`는 모든 Label을 보여 주고, `-L`은 지정한 Label을 별도 열로 표시한다.

---

## 2. 실행 중인 리소스의 Label 관리하기

`kubectl label`을 사용하면 기존 리소스에 Label을 추가하거나 변경할 수 있다.

```bash
kubectl label pod nginx-dev release=stable
kubectl label pod nginx-dev environment=production --overwrite
kubectl label pod nginx-dev release-
kubectl get pod nginx-dev --show-labels
```

운영 환경에서는 명령으로만 값을 바꾸면 원본 YAML과 실제 상태가 달라질 수 있다. 지속할 설정은 매니페스트에도 같은 값으로 반영한다.

Label과 Annotation은 목적이 다르다.

| 구분 | Label | Annotation |
| --- | --- | --- |
| 목적 | 리소스 분류와 선택 | 설명이나 도구용 부가 정보 저장 |
| Selector로 조회 | 가능 | 불가능 |
| 예 | 앱 이름, 환경, 구성 요소 | 담당자, 설명, 외부 시스템 식별자 |

컨트롤러나 Service가 찾아야 하는 정보는 Label로 두고, 선택 조건에 사용할 필요가 없는 설명은 Annotation에 기록한다.

---

## 3. Selector로 원하는 리소스만 조회하기

`-l` 또는 `--selector` 옵션으로 Label 조건에 맞는 리소스만 조회할 수 있다.

```bash
kubectl get pods -l app=nginx
kubectl get pods -l app=nginx,environment=production
kubectl get pods -l 'environment in (dev,production)'
kubectl get pods -l tier
```

쉼표로 연결한 조건은 모두 만족해야 하는 AND 조건이다. 집합 기반 Selector에서는 `In`, `NotIn`, `Exists`, `DoesNotExist`를 사용할 수 있다. 값에 대한 최상위 OR 연산자는 없으므로 여러 값 중 하나를 찾을 때는 `in (...)`을 사용한다.

리소스의 실제 필드로 검색하는 Field Selector와도 구분해야 한다.

```bash
# Label로 검색
kubectl get pods -l app=nginx

# status.phase 필드로 검색
kubectl get pods --field-selector status.phase=Running
```

---

## 4. Selector가 컨트롤러와 Pod를 연결한다

ReplicaSet과 Deployment 같은 컨트롤러는 `spec.selector`에 맞는 Pod를 관리한다. 컨트롤러가 새로 만드는 Pod의 Label은 `spec.template.metadata.labels`에 정의한다.

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: nginx-rs
spec:
  replicas: 2
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
```

여기서는 다음 두 값이 일치해야 한다.

```text
spec.selector.matchLabels.app = nginx
spec.template.metadata.labels.app = nginx
```

값이 다르면 컨트롤러가 자신이 생성한 Pod를 관리 대상으로 찾지 못하므로 리소스 생성이 거부된다. 같은 Namespace에서 여러 컨트롤러의 Selector가 겹치지 않도록 Label을 설계하는 것도 중요하다.

---

## 5. Service도 같은 방식으로 Pod를 찾는다

Service는 고정된 접근 지점을 제공하지만, 실제 요청을 받을 Pod는 Label Selector로 찾는다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-service
spec:
  selector:
    app: nginx
  ports:
    - port: 80
      targetPort: 80
```

앞의 ReplicaSet과 이 Service는 모두 `app: nginx`인 Pod를 선택한다.

```text
ReplicaSet -- selector: app=nginx --> Pod 수 유지
Service    -- selector: app=nginx --> 요청 전달
```

Pod가 교체되어 이름과 IP가 달라져도 새 Pod가 같은 Label을 가지면 컨트롤러와 Service가 다시 찾을 수 있다. 이후 글에서 Selector가 반복해서 등장하는 이유가 바로 이 느슨한 연결 구조 때문이다.

---

## 6. 일관된 Label 체계 만들기

작은 예제에서는 `app: nginx`만으로 충분하지만, 리소스가 많아지면 역할을 구분할 Label이 필요하다.

```yaml
metadata:
  labels:
    app.kubernetes.io/name: nginx
    app.kubernetes.io/instance: web-production
    app.kubernetes.io/component: frontend
    app.kubernetes.io/part-of: shopping-service
```

`app.kubernetes.io/*` 형식은 Kubernetes가 권장하는 공통 Label이다. 학습 예제에서는 짧은 Label을 사용하더라도 같은 의미에 같은 키를 쓰고, 환경이나 버전처럼 바뀔 수 있는 정보를 앱 이름과 분리하는 습관을 들이는 것이 좋다.

---

## 7. 정리

Label은 리소스에 분류 정보를 붙이고, Selector는 조건에 맞는 리소스 집합을 찾는다. `kubectl get -l`로 원하는 Pod를 조회할 수 있으며 ReplicaSet, Deployment, Service도 같은 원리로 관리 대상이나 요청 대상을 선택한다.

이제 Pod를 개별 이름이 아니라 하나의 집합으로 다룰 기반을 마련했다. 다음 글에서는 하나의 Pod 안에서 여러 컨테이너가 실행 설정과 네트워크를 공유하는 방식을 살펴본다.

---

## 참고 자료

* [Kubernetes 문서 - Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/)
* [Kubernetes 문서 - Recommended Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/)
