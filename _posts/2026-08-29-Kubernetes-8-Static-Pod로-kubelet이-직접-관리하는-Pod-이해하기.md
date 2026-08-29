---
layout: post
title: "Kubernetes (8) - Static Pod로 kubelet이 직접 관리하는 Pod 이해하기"
date: 2026-08-29 17:19:59 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "pod", "static-pod", "kubelet", "control-plane", "쿠버네티스"]
---

일반적인 Pod는 API 서버에 매니페스트를 제출하고, 스케줄러와 컨트롤러를 거쳐 노드에서 실행된다. 반면 Static Pod는 특정 노드의 kubelet이 로컬 파일을 직접 읽어 실행·관리하는 Pod다.

이 방식은 API 서버가 아직 준비되지 않은 상황에서도 노드에서 중요한 컴포넌트를 실행할 수 있게 한다. 이번 글에서는 `staticPodPath` 설정, kubeadm 컨트롤 플레인의 매니페스트 디렉토리, Static Pod의 생성·확인·수정 방법을 정리한다.

---

## 1. Static Pod란?

Static Pod는 kubelet이 지정된 경로의 Pod 매니페스트 파일을 감시하고 직접 실행하는 Pod다. 매니페스트는 일반 Pod와 같은 YAML 또는 JSON 형식을 사용하지만, API 서버에 `kubectl apply`로 생성하지 않는다는 점이 가장 큰 차이다.

따라서 Static Pod는 매니페스트 파일이 있는 **특정 노드에만** 실행된다. 스케줄러가 다른 노드를 선택하거나 Deployment·ReplicaSet 같은 컨트롤러가 복제 수와 롤링 업데이트를 관리하지 않는다.

| 구분 | 일반 Pod | Static Pod |
| --- | --- | --- |
| 생성 경로 | API 서버에 요청 | 노드 로컬의 매니페스트 파일 |
| 주 관리 주체 | 컨트롤 플레인과 kubelet | 해당 노드의 kubelet |
| 실행 노드 | 스케줄러가 결정 | 매니페스트를 읽는 kubelet이 있는 노드 |
| 수정·삭제 | `kubectl apply`, `kubectl delete` | 로컬 매니페스트 파일 수정·삭제 |
| 대표 사례 | 애플리케이션 워크로드 | kubeadm 컨트롤 플레인 구성 요소 |

---

## 2. `staticPodPath`로 감시 디렉토리 확인하기

kubelet 설정 파일의 `staticPodPath`는 파일 기반 Static Pod 매니페스트를 찾을 디렉토리를 지정한다. kubelet은 이 경로에서 점으로 시작하지 않는 파일을 주기적으로 검사하고, 파일이 생기거나 사라지면 Static Pod도 생성하거나 제거한다.

```bash
cat /var/lib/kubelet/config.yaml
```

```yaml
staticPodPath: /etc/kubernetes/manifests
```

실습 환경과 kubeadm 구성에서는 `/etc/kubernetes/manifests`를 사용하는 경우가 많다. 실제 경로는 노드의 kubelet 설정을 기준으로 확인해야 하며, 배포 방식에 따라 다를 수 있다.

`staticPodPath`를 다른 디렉토리로 변경했다면 kubelet이 새 설정을 읽도록 재시작한다.

```bash
# kubelet 설정을 수정한 뒤 실행
sudo systemctl restart kubelet
sudo systemctl status kubelet
```

반대로 **이미 설정된 디렉토리 안에서 매니페스트 파일만 수정·추가·삭제하는 경우**에는 kubelet이 변경을 감지하므로 일반적으로 kubelet을 별도로 재시작할 필요가 없다.

---

## 3. kubeadm 컨트롤 플레인이 Static Pod를 사용하는 이유

kubeadm으로 만든 컨트롤 플레인 노드에서는 다음 경로에서 구성 요소의 매니페스트를 확인할 수 있다.

```bash
cd /etc/kubernetes/manifests/
ls
```

```text
etcd.yaml
kube-apiserver.yaml
kube-controller-manager.yaml
kube-scheduler.yaml
```

각 파일은 해당 노드의 kubelet이 직접 실행하는 Static Pod 매니페스트다. API 서버 자체가 아직 동작하지 않아도 kubelet은 로컬 파일과 컨테이너 런타임을 이용해 `kube-apiserver`, `etcd`, `kube-controller-manager`, `kube-scheduler`를 시작할 수 있다.

API 서버가 정상 동작할 때 `kubectl get pods -n kube-system`으로 보이는 컨트롤 플레인 Pod는 Static Pod 자체를 API 서버에 저장한 것이 아니라, kubelet이 API 서버에 표시하는 **Mirror Pod**다. 이름 끝에는 보통 실행 노드 이름이 붙는다. 따라서 Mirror Pod를 `kubectl delete pod`로 지워도 원본 매니페스트 파일이 남아 있으면 kubelet이 다시 표시한다.

```bash
kubectl get pods -n kube-system -o wide
kubectl get pods -n kube-system | grep -E 'etcd|kube-apiserver|kube-controller-manager|kube-scheduler'
```

---

## 4. Static Pod 생성과 변경 흐름

다음은 지정된 Static Pod 디렉토리에 단순한 Nginx Pod 매니페스트를 두는 예시다. 명령은 반드시 대상 노드에서 실행해야 한다.

```yaml
# /etc/kubernetes/manifests/static-web.yaml
apiVersion: v1
kind: Pod
metadata:
  name: static-web
  labels:
    app: static-web
spec:
  containers:
    - name: nginx
      image: nginx:1.27
      ports:
        - containerPort: 80
```

파일을 저장하면 kubelet이 경로를 감시하다가 Pod를 실행한다. 컨테이너 런타임 수준에서는 `crictl`로, API 서버가 이용 가능한 경우에는 Mirror Pod를 통해 `kubectl`로 상태를 확인할 수 있다.

```bash
# 대상 노드에서 실행 중인 컨테이너 확인
sudo crictl ps

# API 서버가 동작하는 경우 Mirror Pod 확인
kubectl get pods -o wide
```

매니페스트의 이미지나 명령을 수정하면 kubelet이 변경을 감지해 Pod를 새 명세에 맞춰 다시 만든다. Static Pod를 제거하려면 `kubectl delete` 대신 매니페스트 파일을 감시 디렉토리 밖으로 옮기거나 삭제해야 한다.

```bash
# 잠시 중지하려면 감시 경로 밖으로 이동
sudo mv /etc/kubernetes/manifests/static-web.yaml /tmp/static-web.yaml

# 다시 실행하려면 감시 경로로 되돌림
sudo mv /tmp/static-web.yaml /etc/kubernetes/manifests/static-web.yaml
```

---

## 5. 운영 시 주의할 점

`/etc/kubernetes/manifests`처럼 Static Pod 디렉토리로 설정된 위치는 일반 파일 보관소가 아니다. kubelet은 숨김 파일을 제외한 파일 확장자를 따로 구분하지 않고 읽으므로, 매니페스트 백업 파일을 같은 디렉토리에 두면 백업까지 Pod 매니페스트로 처리하려 할 수 있다.

특히 `kube-apiserver.yaml.backup`처럼 원본을 복사해 두는 방식은 같은 이름의 Pod 정의가 중복되어 예측하기 어려운 동작을 만들 수 있다. 백업은 반드시 감시 경로 밖의 별도 디렉토리에 보관한다.

```bash
# 권장: Static Pod 감시 경로 밖에 백업 보관
sudo mkdir -p /etc/kubernetes/backup
sudo cp /etc/kubernetes/manifests/kube-apiserver.yaml \
  /etc/kubernetes/backup/kube-apiserver.yaml
```

또한 컨트롤 플레인 매니페스트를 잘못 수정하면 API 서버나 etcd가 중단되어 클러스터 관리 기능을 잃을 수 있다. 변경 전에는 파일을 감시 경로 밖에 백업하고, 한 번에 하나의 변경만 적용하며, 노드 콘솔 접근 방법을 확보한 상태에서 작업하는 편이 안전하다.

---

## 6. 정리

Static Pod는 API 서버에 선언하는 일반 Pod와 달리, 노드의 kubelet이 로컬 매니페스트를 직접 읽어 관리하는 Pod다. `staticPodPath`가 지정한 디렉토리에 매니페스트를 두면 kubelet이 실행하고, 파일 변경·추가·삭제도 감지해 반영한다.

kubeadm 컨트롤 플레인의 `etcd`, `kube-apiserver`, `kube-controller-manager`, `kube-scheduler`는 이 방식으로 실행되는 대표 사례다. Static Pod는 API 서버가 없어도 기동할 수 있는 장점이 있지만, 파일을 잘못 다루면 핵심 구성 요소에 직접 영향을 주므로 감시 디렉토리와 백업 위치를 엄격히 구분해야 한다.

---

## 참고 자료

* [Kubernetes 문서 - Create static Pods](https://kubernetes.io/docs/tasks/configure-pod-container/static-pod/)
