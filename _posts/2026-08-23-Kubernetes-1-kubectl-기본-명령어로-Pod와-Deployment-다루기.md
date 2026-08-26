---
layout: post
title: "Kubernetes (1) - kubectl 기본 명령어로 Pod와 Deployment 다루기"
date: 2026-08-23 00:30:20 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "kubectl", "pod", "deployment", "컨테이너", "쿠버네티스"]
---

Kubernetes 클러스터와 상호작용할 때 사용하는 기본 CLI가 `kubectl`이다. 리소스의 상태를 조회하는 것부터 Pod와 Deployment 생성, 컨테이너 로그 확인, 내부 애플리케이션 접속까지 대부분의 작업을 `kubectl` 명령으로 수행한다.

이번 글에서는 kind로 구성한 로컬 클러스터에서 Nginx Pod와 Apache Deployment를 실행한 기록을 바탕으로, 처음 알아두면 좋은 `kubectl` 명령어를 작업 흐름에 맞춰 정리한다.

---

## 1. kubectl 도움말과 리소스 종류 확인

처음에는 현재 클러스터에서 다룰 수 있는 리소스와 명령어를 확인하는 것부터 시작하면 좋다.

```bash
# kubectl의 전체 명령 목록 확인
kubectl --help

# 현재 API 서버가 지원하는 리소스 종류와 축약형 확인
kubectl api-resources

# 특정 리소스의 필드 설명 확인
kubectl explain pods
```

`kubectl api-resources`는 `pods`, `deployments`, `services`처럼 API 서버가 지원하는 리소스와 축약형을 보여준다. 예를 들어 Pod는 `po`, Deployment는 `deploy`, Service는 `svc`로 줄여 쓸 수 있다.

`kubectl get` 뒤에는 반드시 조회할 리소스 종류가 필요하다. 따라서 `kubectl get`만 실행하면 오류가 나며, `kubectl get pods`나 `kubectl get nodes`처럼 대상을 지정해야 한다.

| 명령 | 확인 대상 |
| --- | --- |
| `kubectl get nodes` | 클러스터를 구성하는 노드 |
| `kubectl get pods` | 현재 네임스페이스의 Pod |
| `kubectl get deployments` | Deployment 상태와 레플리카 수 |
| `kubectl get services` | 네트워크 접근을 위한 Service |

---

## 2. 노드와 Pod 상태 조회하기

`get`은 리소스 목록과 상태를 빠르게 확인할 때 가장 자주 사용한다.

```bash
# 노드의 이름, 상태, 역할 확인
kubectl get nodes

# IP, 컨테이너 런타임 등 상세 열까지 표시
kubectl get nodes -o wide

# Pod 목록과 실행 상태 확인
kubectl get pods

# Pod IP와 배치된 노드까지 표시
kubectl get pods -o wide
```

`-o wide` 옵션을 붙이면 Pod가 어느 노드에 배치되었는지와 Pod IP를 확인할 수 있다. 실습에서는 Nginx Pod에 할당된 Pod IP로 `curl`을 실행해 HTTP 응답을 확인할 수 있었다.

```bash
kubectl get pods -o wide
curl <POD_IP>
```

Pod IP는 클러스터 내부에서의 테스트에는 쓸 수 있지만, Pod가 다시 생성되면 바뀔 수 있다. 애플리케이션을 안정적으로 노출하려면 이후에 Service를 사용하는 것이 일반적이다.

---

## 3. 상세 정보와 YAML·JSON으로 살펴보기

문제가 생겼거나 설정을 자세히 확인해야 할 때는 `describe`와 출력 형식 옵션을 사용한다.

```bash
# 노드의 조건, 할당량, 이벤트 확인
kubectl describe node cka-control-plane

# Deployment의 레플리카, 이미지, 이벤트 확인
kubectl describe deployment mainui

# Pod의 현재 정의를 YAML 또는 JSON으로 출력
kubectl get pod webserver -o yaml
kubectl get pod webserver -o json
```

`describe`는 사람이 읽기 쉬운 형태로 상태, 이벤트, 관련 리소스를 요약한다. 예를 들어 Pod가 `Pending`이나 `ContainerCreating` 상태에 오래 머문다면 Events 영역에서 이미지 다운로드, 스케줄링, 볼륨 마운트 문제를 먼저 확인할 수 있다.

`-o yaml`과 `-o json`은 API 서버에 저장된 리소스 정의 전체를 보여준다. `metadata`, `spec`, `status` 구조를 직접 확인할 수 있어 설정을 파일로 옮기거나 API 객체를 이해할 때 유용하다.

Pod의 API phase는 `Pending`, `Running`, `Succeeded`, `Failed`, `Unknown`으로 구분된다. 반면 `CrashLoopBackOff`, `ImagePullBackOff`, `ContainerCreating`, `Terminating`처럼 `kubectl get pods`의 `STATUS` 열에 보이는 값은 컨테이너의 대기·종료 사유나 표시용 상태일 수 있다. 따라서 문제가 생기면 상태 이름만으로 판단하지 말고 `kubectl describe pod <POD_NAME>`의 Events와 `kubectl logs <POD_NAME>`를 함께 확인하는 것이 좋다.

---

## 4. Pod와 Deployment 생성하기

가장 간단한 실습은 이미지를 하나 지정해 Pod를 실행하는 것이다.

```bash
kubectl run webserver --image=nginx:1.14 --port=80
kubectl get pods
```

`kubectl run`은 위와 같이 단일 Pod를 빠르게 만들 때 편리하다. 다만 Pod를 직접 만들면 Pod가 삭제되었을 때 원하는 개수를 유지해줄 컨트롤러가 없다.

여러 개의 Pod를 유지하는 웹 애플리케이션에는 Deployment를 사용한다.

```bash
kubectl create deployment mainui --image=httpd --replicas=3

kubectl get deployments
kubectl get pods -o wide
```

Deployment는 원하는 레플리카 수를 선언하고, 그 수만큼 Pod가 실행되도록 관리한다. 위 명령을 실행하면 `mainui` Deployment와 이를 관리하는 ReplicaSet, 그리고 Apache 컨테이너를 담은 세 개의 Pod가 생성된다.

| 리소스 | 역할 |
| --- | --- |
| Pod | 하나 이상의 컨테이너를 실행하는 최소 배포 단위 |
| ReplicaSet | 지정한 수의 Pod가 존재하도록 유지 |
| Deployment | ReplicaSet을 관리하고 배포·업데이트를 제어 |

---

## 5. 실행 중인 컨테이너 확인과 접속

Pod가 실행된 뒤에는 로그를 읽고, 필요하면 컨테이너 안에서 명령을 실행할 수 있다.

```bash
# Pod의 기본 컨테이너 로그 확인
kubectl logs webserver

# 로그를 계속 출력
kubectl logs -f webserver

# 실행 중인 컨테이너에서 셸 실행
kubectl exec -it webserver -- /bin/bash
```

하나의 Pod에 컨테이너가 여러 개라면 `-c <컨테이너이름>`으로 대상을 지정한다. 이전에 종료된 컨테이너 인스턴스의 로그는 `kubectl logs -p <POD>`로 확인할 수 있다.

```bash
kubectl logs webserver -c nginx
kubectl logs -p webserver
```

`kubectl exec`로 컨테이너 안의 파일을 수정할 수는 있지만, 이는 임시 확인 용도로만 사용해야 한다. Pod가 재시작되거나 교체되면 컨테이너 파일 시스템의 변경은 사라질 수 있으므로, 실제 설정 변경은 이미지나 Kubernetes 매니페스트로 관리하는 편이 안전하다.

---

## 6. 로컬에서 Pod 포트로 연결하기

클러스터 내부의 Pod에 잠시 접속해보고 싶을 때는 `port-forward`를 사용할 수 있다.

```bash
# 로컬 8080 포트를 Pod의 80 포트로 전달
kubectl port-forward pod/webserver 8080:80
```

명령이 실행 중인 터미널을 유지한 채 다른 터미널에서 다음처럼 접속한다.

```bash
curl http://localhost:8080
```

`port-forward`는 개발과 디버깅에 적합한 임시 연결이다. 터미널을 종료하면 포워딩도 함께 끝나며, 외부 사용자에게 서비스를 지속적으로 공개하는 방법은 아니다.

---

## 7. YAML 파일 만들기와 선언적으로 반영하기

명령어로 만든 Pod는 `--dry-run=client -o yaml`로 YAML 초안을 생성할 수 있다. `--dry-run`만 사용하는 형식은 더 이상 권장되지 않으므로 `--dry-run=client`를 명시한다.

```bash
kubectl run webserver \
  --image=nginx:1.14 \
  --port=80 \
  --dry-run=client \
  -o yaml > webserver-pod.yaml
```

생성된 파일을 검토하고 필요한 라벨, 환경 변수, 리소스 요청·제한 등을 추가한 뒤 리소스를 생성한다. Label은 리소스를 분류하고 Selector로 찾기 위한 짧은 태그이고, Annotation은 빌드 정보나 관리 도구의 설정처럼 검색 대상이 아닌 부가 정보를 기록할 때 사용한다.

```bash
kubectl create -f webserver-pod.yaml
```

이미 존재하는 리소스의 선언을 반복 적용하고 변경 사항을 반영하는 작업에는 보통 다음 명령을 사용한다.

```bash
# 현재 클러스터 상태와 매니페스트의 차이 확인
kubectl diff -f webserver-pod.yaml

# 없으면 생성하고, 있으면 선언 내용에 맞춰 변경
kubectl apply -f webserver-pod.yaml
```

`create`는 같은 이름의 리소스가 이미 있으면 실패하지만, `apply`는 매니페스트를 기준으로 생성과 변경을 함께 처리한다. 따라서 Git으로 YAML을 관리하고 반복 배포하는 흐름에는 `apply`가 잘 맞는다. 다만 리소스를 처음 만들 때부터 `apply`로 관리하거나 `create --save-config`를 사용해야 이후 변경 사항을 일관되게 추적할 수 있다.

Deployment를 반영한 직후에는 원하는 상태가 될 때까지 기다리거나, 필요할 때 관리 중인 Pod를 순차적으로 다시 시작할 수 있다.

```bash
# Deployment가 사용 가능한 상태가 될 때까지 최대 90초 대기
kubectl wait --for=condition=Available deployment/mainui --timeout=90s

# Deployment가 관리하는 Pod를 순차적으로 재시작
kubectl rollout restart deployment/mainui

# 재시작한 롤아웃 진행 상황 확인
kubectl rollout status deployment/mainui
```

`kubectl wait`는 다음 명령을 실행하기 전에 리소스가 준비되었는지 확인해야 하는 자동화 과정에서 특히 유용하다. `rollout restart`는 컨테이너 설정을 임시로 고치는 명령이 아니라, Deployment의 Pod 템플릿을 갱신해 새 Pod를 만들도록 하는 방식이다.

---

## 8. 리소스 정리

실습을 마쳤다면 만든 리소스를 명시적으로 삭제한다.

```bash
kubectl delete pod webserver
kubectl delete deployment mainui
```

Deployment를 삭제하면 Deployment가 관리하던 ReplicaSet과 Pod도 함께 삭제된다. 삭제 전에 `kubectl get pods`와 `kubectl get deployments`로 대상을 다시 확인하는 습관이 중요하다.

---

## 9. 정리

`kubectl`은 Kubernetes 리소스를 조회하고 생성·수정·삭제하는 기본 도구다. `get`과 `describe`로 상태와 이벤트를 확인하고, `logs`, `exec`, `port-forward`로 실행 중인 애플리케이션을 진단할 수 있다. Pod의 phase와 `STATUS` 표시값은 구분해 해석해야 정확한 원인을 찾을 수 있다.

간단한 실습은 `kubectl run`으로 Pod를 바로 생성할 수 있지만, 여러 Pod를 안정적으로 유지해야 하는 애플리케이션은 Deployment로 관리하는 것이 적합하다. 명령어로 빠르게 검증한 뒤에는 `--dry-run=client -o yaml`로 초안을 만들고, `diff`, `apply`, `wait`를 활용해 YAML을 재현 가능하게 관리하는 흐름으로 발전시키면 좋다.
