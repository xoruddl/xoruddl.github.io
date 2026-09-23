---
layout: post
title: "Kubernetes (1) - kubectl 기본 명령어로 Pod와 Deployment 다루기"
date: 2026-08-23 12:01:00 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "kubectl", "pod", "deployment", "컨테이너", "쿠버네티스"]
---

<!-- runnable-kubernetes-manifests -->
> **실습 전 확인하기**: `kubectl`이 실습용 클러스터를 가리키는지 먼저 확인한다. `cat <<'EOF' > 파일명`으로 시작하는 블록은 터미널에 그대로 붙여넣으면 현재 디렉터리에 YAML 파일이 만들어지고, 이어지는 `kubectl apply -f` 명령으로 적용한다. 필드 일부만 보여 주는 YAML 조각은 설명용이다.

Kubernetes 클러스터와 상호작용할 때 사용하는 기본 CLI가 `kubectl`이다. 리소스 조회, Pod와 Deployment 생성, 로그 확인, 컨테이너 접속까지 대부분의 작업을 `kubectl` 명령으로 수행한다.

이번 글에서는 kind로 구성한 로컬 클러스터에서 Nginx Pod와 Apache Deployment를 실행하며, 처음 알아두면 좋은 `kubectl` 명령어를 작업 흐름에 맞춰 정리한다. Deployment의 내부 구조는 10편부터 자세히 다룬다.

---


## 1. kubectl 도움말과 리소스 종류 확인

처음에는 현재 클러스터에서 다룰 수 있는 리소스와 명령어를 확인하는 것부터 시작한다.

```bash
# kubectl의 전체 명령 목록 확인
kubectl --help

# 현재 API 서버가 지원하는 리소스 종류와 축약형 확인
kubectl api-resources

# 특정 리소스의 필드 설명 확인
kubectl explain pods
```

`kubectl api-resources`는 API 서버가 지원하는 리소스와 축약형을 보여준다. 예를 들어 Pod는 `po`, Deployment는 `deploy`, Service는 `svc`로 줄여 쓸 수 있다.

| 명령 | 확인 대상 |
| --- | --- |
| `kubectl get nodes` | 클러스터를 구성하는 노드 |
| `kubectl get pods` | 현재 네임스페이스의 Pod |
| `kubectl get deployments` | Deployment 상태와 레플리카 수 |
| `kubectl get services` | 네트워크 접근을 위한 Service |

---

## 2. Pod와 Deployment 생성하기

가장 간단한 실습은 이미지를 하나 지정해 Pod를 실행하는 것이다.

```bash
kubectl run webserver --image=nginx:1.14 --port=80
kubectl get pods
```

`kubectl run`은 단일 Pod를 빠르게 만들 때 편리하다. 다만 이렇게 만든 Pod는 삭제되어도 다시 만들어 줄 컨트롤러가 없다. 여러 개의 Pod를 유지해야 하는 웹 애플리케이션에는 Deployment를 사용한다.

```bash
kubectl create deployment mainui --image=httpd --replicas=3
kubectl get deployments
```

위 명령을 실행하면 `mainui` Deployment와 이를 관리하는 ReplicaSet, 그리고 Apache 컨테이너를 담은 세 개의 Pod가 생성된다.

| 리소스 | 역할 |
| --- | --- |
| Pod | 하나 이상의 컨테이너를 실행하는 최소 배포 단위 |
| ReplicaSet | 지정한 수의 Pod가 존재하도록 유지 |
| Deployment | ReplicaSet을 관리하고 배포·업데이트를 제어 |

---

## 3. 상태 조회와 상세 정보 확인

`get`은 리소스 목록과 상태를 빠르게 확인할 때, `describe`는 문제 원인을 자세히 살펴볼 때 사용한다.

```bash
# 노드와 Pod 목록 확인 (-o wide: IP와 배치된 노드까지 표시)
kubectl get nodes -o wide
kubectl get pods -o wide

# 상태, 이벤트 등 상세 정보 확인
kubectl describe pod webserver
kubectl describe deployment mainui

# API 서버에 저장된 리소스 정의 전체를 YAML로 출력
kubectl get pod webserver -o yaml
```

Pod가 `Pending`, `ContainerCreating`, `CrashLoopBackOff` 같은 상태에 오래 머문다면 `describe` 출력 아래쪽의 Events에서 이미지 다운로드, 스케줄링 문제를 먼저 확인한다.

---

## 4. 로그 확인과 컨테이너 접속

Pod가 실행된 뒤에는 로그를 읽고, 필요하면 컨테이너 안에서 명령을 실행할 수 있다.

```bash
# Pod의 로그 확인 (-f를 붙이면 계속 출력)
kubectl logs webserver

# 실행 중인 컨테이너에서 셸 실행
kubectl exec -it webserver -- /bin/bash
```

`exec`로 컨테이너 안의 파일을 고친 내용은 Pod가 교체되면 사라진다. 확인 용도로만 사용하고, 실제 설정 변경은 이미지나 매니페스트로 관리한다.

---

## 5. 로컬에서 Pod 포트로 연결하기

클러스터 내부의 Pod에 잠시 접속해보고 싶을 때는 `port-forward`를 사용한다.

```bash
# 로컬 8080 포트를 Pod의 80 포트로 전달
kubectl port-forward pod/webserver 8080:80
```

명령이 실행 중인 터미널을 유지한 채 다른 터미널에서 접속한다. 터미널을 종료하면 연결도 끝나는 임시 방법이며, 서비스를 지속적으로 공개하려면 Service를 사용한다.

```bash
curl http://localhost:8080
```

---

## 6. YAML 파일로 리소스 관리하기

명령어 대신 리소스의 원하는 상태를 YAML 파일로 작성해 둘 수 있다. 이 파일을 **매니페스트(Manifest)** 라고 한다. 다음 명령으로 `webserver-pod.yaml` 파일을 만든다.

```bash
cat <<'EOF' > webserver-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: webserver
  labels:
    app: webserver
spec:
  containers:
    - name: webserver
      image: nginx:1.14
      ports:
        - containerPort: 80
EOF
```

`metadata.name`은 Pod 이름이고, `spec.containers`에는 실행할 컨테이너의 이름과 이미지를 적는다. 앞에서 `kubectl run`으로 만든 Pod를 지운 뒤 파일로 다시 만든다.

```bash
kubectl delete pod webserver

# 파일에 정의한 Pod 생성
kubectl apply -f webserver-pod.yaml
kubectl get pod webserver
```

`apply`는 리소스가 없으면 만들고, 있으면 파일 내용에 맞춰 변경한다. 그래서 YAML을 Git으로 관리하며 반복 배포하는 흐름에 잘 맞는다.

---

## 7. 리소스 정리

실습을 마쳤다면 만든 리소스를 삭제한다. Deployment를 삭제하면 관리하던 ReplicaSet과 Pod도 함께 삭제된다.

```bash
kubectl delete pod webserver
kubectl delete deployment mainui
```

---

## 8. 정리

`kubectl`은 Kubernetes 리소스를 조회하고 생성·수정·삭제하는 기본 도구다. `get`과 `describe`로 상태와 이벤트를 확인하고, `logs`, `exec`, `port-forward`로 실행 중인 애플리케이션을 살펴볼 수 있다.

간단한 실습은 `kubectl run`으로 Pod를 바로 만들 수 있지만, 여러 Pod를 안정적으로 유지해야 하는 애플리케이션은 Deployment로 관리한다. 익숙해지면 YAML 매니페스트와 `kubectl apply`로 리소스를 재현 가능하게 관리하는 흐름으로 넘어가면 된다.
