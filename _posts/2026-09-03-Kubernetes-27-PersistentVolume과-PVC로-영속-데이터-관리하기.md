---
layout: post
title: "Kubernetes (27) - PersistentVolume과 PVC로 영속 데이터 관리하기"
date: 2026-09-03 22:10:53 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "persistent-volume", "persistent-volume-claim", "pvc", "storageclass", "storage", "쿠버네티스"]
---

Pod 안에서 쓰던 데이터를 Pod가 다시 만들어진 뒤에도 보존해야 할 때가 있다. 데이터베이스 파일, 사용자가 올린 파일, 메시지 큐 데이터처럼 잃으면 안 되는 데이터가 대표적이다.

Kubernetes에서는 PersistentVolume(PV)과 PersistentVolumeClaim(PVC)을 사용해 Pod와 저장소를 분리한다. 처음에는 PV를 "준비된 디스크", PVC를 "디스크 사용 요청서"라고 생각하면 이해하기 쉽다.

---

## 1. PV와 PVC는 저장소를 Pod와 분리한다

PV는 클러스터가 제공하는 실제 저장 공간을 나타내는 리소스다. NFS, 클라우드 디스크, CSI 드라이버가 제공하는 스토리지 등이 PV의 실제 저장소가 될 수 있다.

PVC는 애플리케이션이 필요한 저장소의 크기와 접근 방식을 요청하는 리소스다. Pod는 실제 디스크가 어떤 제품인지 알 필요 없이, 승인된 요청서인 PVC의 이름만 참조한다.

```text
Pod ── PVC 참조 ──→ PVC ── 바인딩 ──→ PV ──→ 실제 스토리지
```

| 리소스 | 누가 주로 관리하는가 | 역할 |
| --- | --- | --- |
| PV | 클러스터 관리자 또는 StorageClass 프로비저너 | 실제 스토리지와 Kubernetes를 연결 |
| PVC | 애플리케이션 개발자 | 필요한 크기·접근 모드를 요청 |
| StorageClass | 클러스터 관리자 | 동적 생성에 사용할 스토리지 종류와 정책 정의 |

이 구조 덕분에 애플리케이션 매니페스트는 NFS 주소나 클라우드 디스크 ID를 직접 알 필요가 없다. 스토리지 구현을 바꾸더라도 Pod는 같은 PVC 이름을 참조하는 방식으로 유지할 수 있다.

---

## 2. 정적 프로비저닝과 동적 프로비저닝

PV를 관리자가 미리 만드는 방식을 **정적 프로비저닝**이라고 한다. 이 글의 실습은 이해하기 쉽도록 이 방식을 사용한다.

반대로 StorageClass가 설정된 클러스터에서는 PVC를 만들면 CSI 프로비저너가 실제 스토리지를 만들고 PV를 자동으로 생성·연결할 수 있다. 이를 **동적 프로비저닝**이라고 하며, 클라우드와 운영 환경에서는 보통 이 방식을 사용한다.

처음에는 다음 흐름만 기억하면 된다.

```text
1. 관리자 또는 StorageClass가 PV를 준비한다.
2. 개발자가 PVC로 "1Gi가 필요합니다"라고 요청한다.
3. Kubernetes가 조건이 맞는 PV와 PVC를 연결한다(Bound).
4. Pod가 PVC 이름을 참조해 파일을 사용한다.
```

정적 프로비저닝에서는 1번을 관리자가 직접 수행한다. 동적 프로비저닝에서는 PVC 요청을 받은 StorageClass와 CSI 드라이버가 1번을 자동으로 처리한다.

---

## 3. 접근 모드와 회수 정책

PVC는 필요한 접근 모드를 요청하고 Kubernetes는 이를 만족하는 PV를 찾는다. 접근 모드는 "몇 개의 노드가 어떤 방식으로 마운트할 수 있는가"를 나타내며, 스토리지 종류가 지원해야만 사용할 수 있다.

| 모드 | 의미 |
| --- | --- |
| `ReadWriteOnce` (RWO) | 한 **노드**에서 읽기·쓰기 마운트 가능. 같은 노드의 여러 Pod가 함께 사용할 수 있음 |
| `ReadOnlyMany` (ROX) | 여러 노드에서 읽기 전용 마운트 가능 |
| `ReadWriteMany` (RWX) | 여러 노드에서 읽기·쓰기 마운트 가능 |
| `ReadWriteOncePod` (RWOP) | 클러스터 전체에서 단일 Pod만 읽기·쓰기 가능. CSI 볼륨에서 지원 |

처음에는 RWO와 RWX를 구분하는 것으로 충분하다. 단일 노드에서 실행되는 실습이나 일반적인 블록 디스크는 RWO를, 여러 노드의 Pod가 같은 파일을 함께 써야 하는 경우에는 RWX를 검토한다. 실제 지원 범위는 NFS, 클라우드 디스크, CSI 드라이버 등 스토리지 구현에 따라 다르다.

PVC가 삭제된 뒤 실제 저장소를 어떻게 처리할지는 PV의 `persistentVolumeReclaimPolicy`로 정한다.

| 정책 | PVC 삭제 뒤 동작 |
| --- | --- |
| `Retain` | PV와 데이터를 남겨 관리자가 직접 확인·정리 |
| `Delete` | PV와 연결된 실제 스토리지를 함께 삭제할 수 있음 |

기본 StorageClass에서 동적으로 만든 볼륨은 보통 `Delete` 정책을 사용한다. 즉, PVC를 지우는 일이 실제 데이터를 지우는 일로 이어질 수 있다. 중요한 데이터라면 삭제 전에 StorageClass와 PV의 회수 정책을 반드시 확인한다. 과거의 `Recycle` 정책은 더 이상 권장하지 않는다.

---

## 4. 단일 노드에서 PV·PVC 연결 확인하기

이제 PV, PVC, Pod를 차례로 만든다. 다음 예제는 학습용 단일 노드 클러스터에서 `hostPath`를 PV의 실제 저장소로 사용하는 정적 프로비저닝 예제다. 다중 노드 운영 환경에서는 `hostPath`에 의존하는 PV를 사용하지 않는 것이 좋으므로 Minikube·kind 같은 로컬 실습 환경에서만 사용한다.

`path`는 **kubectl을 실행하는 컴퓨터가 아니라 Kubernetes 노드 안의 경로**다. Minikube처럼 노드가 VM이나 컨테이너라면 노드 안에 이 경로가 만들어진다.

```yaml
# local-pv.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-pv
spec:
  capacity:
    # PVC와 연결할 때 기준이 되는 용량 정보다.
    storage: 5Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /data/kubernetes
    # 노드에 경로가 없으면 디렉터리를 만든다.
    type: DirectoryOrCreate
```

`capacity.storage: 5Gi`는 PVC와 PV를 연결할 때 사용하는 용량 정보다. `hostPath` 디렉터리 자체의 실제 용량을 5 Gi로 제한하는 설정은 아니다.

다음 PVC는 "RWO 방식으로 1 Gi가 필요하다"고 요청한다. 1 Gi는 PV가 제공하는 5 Gi보다 작고, `manual`이라는 StorageClass 이름도 같으므로 이 PV와 연결될 수 있다.

```yaml
# local-pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: local-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: manual
```

```bash
kubectl apply -f local-pv.yaml
kubectl apply -f local-pvc.yaml
kubectl get pv
kubectl get pvc
```

PVC가 적합한 PV를 찾으면 두 리소스의 상태가 `Bound`가 된다. `kubectl get pv`와 `kubectl get pvc`에서 둘 다 `Bound`로 보이면 연결이 성공한 것이다.

---

## 5. Pod에서 PVC 사용하기

이제 Pod는 PV가 아닌 PVC를 참조해 저장소를 사용한다. Pod는 저장소 종류 대신 사용할 PVC의 이름만 안다.

```yaml
# local-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: local-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["/bin/sh", "-c", "sleep 3600"]
      volumeMounts:
        - name: app-data
          # PVC를 컨테이너 안의 /data 경로에서 사용한다.
          mountPath: /data
  volumes:
    - name: app-data
      persistentVolumeClaim:
        claimName: local-pvc
```

```bash
kubectl apply -f local-pod.yaml
kubectl exec local-pod -- sh -c 'echo "saved by PVC" > /data/message.txt'
kubectl exec local-pod -- cat /data/message.txt
```

`kubectl exec`는 지정한 Pod의 컨테이너 안에서 명령을 실행하므로, 여기서 사용한 `/data/message.txt`는 **컨테이너 내부 경로**다. `local-pod.yaml`에서 `mountPath: /data`로 지정한 바로 그 경로이며, `local-pv.yaml`에서 정의한 `hostPath.path: /data/kubernetes`(노드 경로)와는 별개의 관점이다.

실제로는 PV의 `hostPath`가 노드의 `/data/kubernetes` 디렉터리를 컨테이너의 `/data`에 마운트해주는 구조이므로, 컨테이너 안에서 `/data/message.txt`에 쓴 파일은 물리적으로 노드의 `/data/kubernetes/message.txt`에 저장된다. 즉 같은 파일을 두 가지 경로로 바라볼 수 있는 셈이다.

| 관점 | 경로 | 확인 방법 |
| --- | --- | --- |
| 컨테이너(Pod) 내부 | `/data/message.txt` | `kubectl exec local-pod -- cat /data/message.txt` |
| 노드(호스트) | `/data/kubernetes/message.txt` | 해당 노드에 SSH 접속 후 `cat /data/kubernetes/message.txt` (minikube라면 `minikube ssh` 후 실행) |

`/data/message.txt`가 출력되면 Pod가 PVC를 통해 파일을 쓰고 읽은 것이다. Pod를 삭제한 뒤에도 PVC와 PV를 삭제하지 않았다면 이 데이터는 남는다. 새 Pod가 같은 PVC를 다시 참조하면 그 파일을 다시 읽을 수 있다.

---

## 6. 정리

PV는 클러스터가 준비한 실제 저장소이고, PVC는 애플리케이션이 필요한 저장소를 요청하는 리소스다. Pod는 PVC만 참조하므로 스토리지의 실제 구현과 분리된다.

처음에는 정적 프로비저닝으로 PV·PVC·Pod의 연결 흐름을 익히면 좋다. 운영 환경에서는 StorageClass와 CSI 드라이버가 PVC 요청에 맞춰 저장소를 자동으로 만드는 동적 프로비저닝을 주로 사용한다. 데이터를 안전하게 다루려면 RWO·RWX 같은 접근 모드와 `Retain`·`Delete` 회수 정책을 함께 확인해야 한다.

---

## 참고 자료

* [Kubernetes 문서 - Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
* [Kubernetes 문서 - Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/)
