---
layout: post
title: "Kubernetes (2) - Namespace로 리소스 분리하고 context 전환하기"
date: 2026-08-23 01:50:16 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "kubectl", "namespace", "context", "kubeconfig", "쿠버네티스"]
---

Kubernetes에서 Namespace는 하나의 클러스터 안에서 리소스를 논리적으로 분리하는 단위다. 같은 이름의 Pod라도 서로 다른 Namespace에 만들 수 있어, 개발·운영 환경이나 팀별 리소스를 구분하는 데 유용하다.

이번 글에서는 Namespace 목록을 확인하고, `blue`와 `orange` Namespace를 만든 뒤 Pod를 배치하는 과정을 정리한다. 또한 kubeconfig의 context에 기본 Namespace를 연결해 매번 `-n` 옵션을 쓰지 않는 방법도 함께 살펴본다.

---

## 1. Namespace란?

Namespace는 클러스터 범위의 리소스를 여러 논리적 공간으로 나누는 기능이다. Pod, Service, Deployment처럼 대부분의 워크로드 리소스는 Namespace에 속한다. 반면 Node나 Namespace 자체처럼 클러스터 전체에 적용되는 리소스는 특정 Namespace에 속하지 않는다.

새 클러스터에는 보통 다음과 같은 기본 Namespace가 있다.

```bash
kubectl get namespaces
```

| Namespace | 용도 |
| --- | --- |
| `default` | Namespace를 지정하지 않았을 때 리소스가 생성되는 기본 공간 |
| `kube-system` | CoreDNS, kube-proxy 등 Kubernetes 시스템 구성 요소 |
| `kube-public` | 모든 사용자가 읽을 수 있도록 공개하는 리소스용 공간 |
| `kube-node-lease` | 노드의 상태 신호(Lease)를 관리하는 공간 |

로컬 kind 환경에서는 스토리지 프로비저너를 위한 `local-path-storage` 같은 Namespace가 추가로 보일 수 있다. 시스템 Namespace의 리소스는 클러스터 동작과 직결되므로, 실습 중에는 `default`나 별도로 만든 Namespace를 사용하는 편이 안전하다.

---

## 2. 현재 Namespace와 전체 리소스 조회하기

`kubectl get pods`는 현재 context에 설정된 Namespace의 Pod만 조회한다. 별도 설정이 없다면 기본값은 `default`다.

```bash
# default Namespace의 Pod 조회
kubectl get pods

# 특정 Namespace의 Pod 조회
kubectl get pods -n kube-system

# 모든 Namespace의 Pod 조회
kubectl get pods --all-namespaces
```

`--all-namespaces` 옵션을 사용하면 출력 첫 열에 `NAMESPACE`가 추가된다. 같은 이름의 Pod가 여러 Namespace에 있어도 어느 공간에 속하는지 구분할 수 있다.

```text
NAMESPACE     NAME    READY   STATUS    RESTARTS   AGE
blue          mypod   1/1     Running   0          107s
default       mypod   1/1     Running   0          14m
```

따라서 리소스를 조회하거나 삭제할 때는 대상 Namespace를 항상 의식해야 한다. 예를 들어 `kubectl delete pod mypod`는 현재 Namespace의 `mypod`만 삭제한다.

---

## 3. Namespace 만들기

Namespace는 명령어로 바로 만들거나 YAML 매니페스트로 선언할 수 있다.

```bash
# blue Namespace 생성
kubectl create namespace blue

# 생성하지 않고 YAML 초안만 출력
kubectl create namespace orange --dry-run=client -o yaml
```

`--dry-run=client`를 사용하면 API 서버에 리소스를 만들지 않고 클라이언트에서 YAML만 생성한다. `--dry-run`만 사용하는 이전 형식은 더 이상 권장되지 않는다.

다음처럼 파일로 저장해 선언적으로 생성할 수도 있다.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: orange
```

```bash
kubectl create -f orange-ns.yaml
kubectl get namespaces
```

반복해서 관리할 리소스는 YAML 파일을 버전 관리하고 `kubectl apply -f orange-ns.yaml`로 반영하는 방식이 편리하다.

---

## 4. 원하는 Namespace에 Pod 배치하기

Pod와 같은 Namespace 범위 리소스는 명령어의 `-n` 옵션으로 생성 위치를 지정할 수 있다.

```bash
# blue Namespace에 nginx.yaml의 Pod 생성
kubectl create -f nginx.yaml -n blue
```

매니페스트의 `metadata.namespace`에 Namespace를 적는 방법도 있다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: mypod
  namespace: orange
  labels:
    run: webserver
spec:
  containers:
    - name: webserver
      image: nginx:1.14
      ports:
        - containerPort: 80
```

```bash
kubectl create -f nginx.yaml
kubectl get pods -n orange
```

리소스가 어느 Namespace에 있는지 모를 때는 다음처럼 전체 Namespace를 조회한다.

```bash
kubectl get pods --all-namespaces
```

같은 `mypod`라는 이름도 `default`, `blue`, `orange`에 각각 존재할 수 있다. 이름의 유일성은 클러스터 전체가 아니라 Namespace 내부에서 보장된다.

---

## 5. context에 기본 Namespace 설정하기

매번 `-n blue`를 붙이는 대신, kubeconfig context에 기본 Namespace를 지정할 수 있다. context는 클러스터, 인증 사용자, 기본 Namespace를 묶어 둔 접속 설정이다.

먼저 현재 설정을 확인한다.

```bash
kubectl config view
kubectl config current-context
```

그다음 `blue` Namespace를 기본값으로 사용하는 context를 만든다.

```bash
kubectl config set-context blue@kubernetes \
  --cluster=cka \
  --user=kubernetes-admin \
  --namespace=blue

kubectl config use-context blue@kubernetes
kubectl config current-context
```

이제 `kubectl get pods`를 실행하면 `blue` Namespace의 Pod가 조회된다. 다른 Namespace는 명시적으로 지정해 조회할 수 있다.

```bash
# 현재 context의 기본 Namespace인 blue 조회
kubectl get pods

# default Namespace를 명시해 조회
kubectl get pods -n default
```

실습을 마친 뒤 원래 context로 돌아가려면 `use-context`를 다시 실행한다.

```bash
kubectl config use-context kubernetes-admin@cka
```

---

## 6. Namespace 분리만으로는 충분하지 않다

Namespace는 리소스 이름과 관리 범위를 나누는 논리적 경계이지만, 그 자체로 사용자 권한이나 Pod 네트워크 통신을 완전히 차단하지는 않는다. 여러 팀이나 환경이 하나의 클러스터를 함께 사용할 때는 Namespace와 함께 권한과 네트워크 정책을 설계해야 한다.

RBAC(Role-Based Access Control)의 `Role`과 `RoleBinding`을 사용하면 사용자나 ServiceAccount가 특정 Namespace 안에서만 필요한 리소스를 조회·변경하도록 제한할 수 있다. 클러스터 전체 권한이 필요한 경우에는 `ClusterRole`, `ClusterRoleBinding`을 사용하지만, 가능한 한 Namespace 범위의 최소 권한을 부여하는 편이 안전하다.

또한 NetworkPolicy는 어떤 Pod가 다른 Pod 또는 외부와 통신할 수 있는지를 제어하는 리소스다. Namespace가 다르다는 이유만으로 통신이 자동 차단되는 것은 아니며, 실제 차단은 NetworkPolicy를 지원하는 CNI 네트워크 플러그인에서 정책을 적용했을 때 이뤄진다.

| 목적 | 함께 사용하는 기능 |
| --- | --- |
| 리소스 이름·관리 범위 구분 | Namespace |
| API 조회·변경 권한 제한 | RBAC의 Role, RoleBinding |
| Pod 간 인바운드·아웃바운드 통신 제한 | NetworkPolicy |

---

## 7. Namespace와 리소스 삭제하기

특정 Namespace의 Pod만 삭제할 때는 Namespace를 함께 명시한다.

```bash
kubectl delete pod mypod -n default
```

Namespace 자체를 삭제하면 그 안에 포함된 Namespace 범위 리소스도 함께 삭제된다.

```bash
kubectl delete namespace blue
```

Namespace 삭제는 여러 Pod, Service, Deployment를 한 번에 제거할 수 있으므로 대상과 환경을 먼저 확인해야 한다. 특히 운영 Namespace를 삭제하는 명령은 되돌리기 어렵기 때문에 실습용 Namespace에만 적용하는 것이 좋다.

---

## 8. 정리

Namespace는 하나의 Kubernetes 클러스터 안에서 리소스를 논리적으로 분리하는 기준이다. `default`는 Namespace를 지정하지 않았을 때 사용되며, `kube-system`에는 Kubernetes의 핵심 구성 요소가 실행된다.

`-n <namespace>`와 `--all-namespaces`로 원하는 범위의 리소스를 정확히 조회·관리할 수 있다. 자주 사용하는 공간은 kubeconfig context에 기본 Namespace로 등록해 두면 명령어를 간결하게 유지하면서도 다른 환경의 리소스를 잘못 조작할 가능성을 줄일 수 있다.

다만 Namespace만으로는 완전한 격리가 되지 않는다. 여러 팀이나 환경이 클러스터를 공유한다면 RBAC으로 API 권한을 최소화하고, NetworkPolicy로 필요한 통신만 허용해야 논리적 분리를 실제 운영 경계로 발전시킬 수 있다.
