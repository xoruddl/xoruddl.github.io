---
layout: post
title: "Kubernetes (28) - NFS PersistentVolume으로 여러 Pod가 파일 공유하기"
date: 2026-09-03 22:12:54 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "nfs", "persistent-volume", "persistent-volume-claim", "pvc", "readwritemany", "storage", "쿠버네티스"]
---

여러 노드에서 실행되는 Pod가 같은 파일을 함께 읽고 써야 할 때가 있다. 예를 들어 여러 웹 서버 Pod가 업로드 파일을 공유하거나, 여러 작업 Pod가 같은 결과 디렉터리를 사용해야 하는 경우다.

NFS(Network File System)는 네트워크로 공유한 하나의 디렉터리를 여러 노드에서 마운트할 수 있는 파일 시스템이다. Kubernetes에서는 NFS 공유 디렉터리를 PersistentVolume(PV)으로 등록하고, PersistentVolumeClaim(PVC)을 거쳐 Pod에 연결할 수 있다.

---

## 1. NFS는 네트워크 너머의 같은 폴더를 사용한다

일반적인 노드 로컬 디스크는 해당 노드에서만 접근할 수 있다. 반면 NFS 서버는 네트워크에 공유 디렉터리를 제공하고, Kubernetes 노드는 이 디렉터리를 마운트해 사용할 수 있다.

```text
NFS 서버의 /srv/nfs/k8s
          │
          ├─ 노드 A의 Pod ── /data
          └─ 노드 B의 Pod ── /data
```

NFS는 여러 노드에서 읽고 쓰는 `ReadWriteMany`(RWX) 접근 모드를 지원할 수 있다. 다만 실제 사용 가능 여부는 NFS 서버의 export 설정과 권한에 달려 있다. 여러 Pod가 같은 파일을 동시에 수정하면 애플리케이션 수준에서 충돌을 제어해야 한다.

---

## 2. NFS 서버와 Kubernetes 노드 준비하기

이 글의 매니페스트를 적용하기 전에 다음 준비가 필요하다.

| 위치 | 필요한 준비 |
| --- | --- |
| NFS 서버 | NFS 서버 패키지 설치, 공유 디렉터리 생성, Kubernetes 노드가 접근할 수 있도록 export 설정 |
| 모든 Kubernetes 노드 | NFS 클라이언트 도구 설치 |
| 네트워크 | 각 노드가 NFS 서버의 IP와 포트에 연결 가능 |

Ubuntu 기반 NFS 서버에서는 다음처럼 패키지를 설치하고 공유 디렉터리를 만들 수 있다.

```bash
sudo apt update
sudo apt install -y nfs-kernel-server
sudo mkdir -p /srv/nfs/k8s
```

`/etc/exports`에는 모든 클라이언트를 허용하는 `*` 대신, 실제 Kubernetes 노드가 있는 네트워크만 허용하는 편이 안전하다. 예를 들어 노드 네트워크가 `10.0.0.0/24`라면 다음처럼 설정한다.

```text
/srv/nfs/k8s 10.0.0.0/24(rw,sync,no_subtree_check,root_squash)
```

설정을 적용하고 export 목록을 확인한다.

```bash
sudo exportfs -ra
sudo exportfs -v
```

모든 Kubernetes 노드에는 NFS 클라이언트를 설치한다. 배포판에 따라 패키지 이름이 다를 수 있으며, Ubuntu·Debian 계열에서는 다음 명령을 사용한다.

```bash
sudo apt install -y nfs-common
```

공유 디렉터리의 파일 권한은 애플리케이션 컨테이너의 실행 사용자와 그룹에 맞춰 설정한다. 학습 편의를 위해 `chmod 777`로 모두에게 쓰기 권한을 주는 방식은 운영 환경에서 피하는 것이 좋다.

---

## 3. NFS PersistentVolume 만들기

NFS 서버가 준비됐다면 공유 디렉터리를 PV로 등록한다. `server`와 `path`는 반드시 실제 NFS 서버 주소와 export 경로로 바꾼다.

```yaml
# nfs-pv.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: nfs-pv
spec:
  capacity:
    # PVC와 연결할 때 기준이 되는 용량 정보다.
    storage: 10Gi
  volumeMode: Filesystem
  accessModes:
    # 여러 노드에서 읽고 쓰는 사용 사례를 요청한다.
    - ReadWriteMany
  persistentVolumeReclaimPolicy: Retain
  storageClassName: nfs-storage
  nfs:
    server: 192.168.56.10
    path: /srv/nfs/k8s
```

이 예제의 `capacity.storage: 10Gi`는 PVC와 PV를 연결할 때 사용하는 정보다. NFS 서버의 디렉터리 용량을 Kubernetes가 자동으로 10 Gi로 제한하는 설정은 아니다. 실제 용량 제한은 NFS 서버의 파일 시스템 또는 별도 quota 정책으로 관리한다.

`persistentVolumeReclaimPolicy: Retain`을 지정했으므로 PVC를 삭제해도 공유 디렉터리의 데이터를 자동으로 지우지 않는다. 공유 데이터를 실수로 삭제하지 않게 하려면 유용하지만, 사용이 끝난 데이터는 관리자가 별도로 정리해야 한다.

```bash
kubectl apply -f nfs-pv.yaml
kubectl get pv
```

---

## 4. NFS PVC를 요청하고 Pod에 연결하기

다음 PVC는 NFS PV에 5 Gi와 RWX 접근 모드를 요청한다. `storageClassName`과 접근 모드가 PV와 맞아야 연결할 수 있다.

```yaml
# nfs-pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: nfs-pvc
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 5Gi
  storageClassName: nfs-storage
```

```bash
kubectl apply -f nfs-pvc.yaml
kubectl get pvc
```

PVC 상태가 `Bound`가 되면 Pod에서 사용할 수 있다. Pod에는 NFS 서버 주소가 아니라 PVC 이름만 작성한다.

```yaml
# nfs-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: nfs-test-pod
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["/bin/sh", "-c", "sleep 3600"]
      volumeMounts:
        - name: shared-data
          # NFS 공유 디렉터리를 컨테이너의 /data에서 사용한다.
          mountPath: /data
  volumes:
    - name: shared-data
      persistentVolumeClaim:
        claimName: nfs-pvc
```

```bash
kubectl apply -f nfs-pod.yaml
kubectl exec nfs-test-pod -- sh -c 'echo "Hello Kubernetes NFS" > /data/message.txt'
kubectl exec nfs-test-pod -- cat /data/message.txt
```

컨테이너에서 쓴 `/data/message.txt`는 NFS 서버의 `/srv/nfs/k8s/message.txt`에도 저장된다. NFS 서버에서 파일을 확인하거나, 같은 PVC를 참조하는 다른 Pod에서 파일을 읽어 보면 공유가 정상적으로 동작하는지 확인할 수 있다.

---

## 5. 운영 시 확인할 점

| 확인 항목 | 이유 |
| --- | --- |
| NFS 서버 접근 제어 | export 범위를 노드 네트워크로 제한하고 불필요한 쓰기 권한을 주지 않음 |
| 파일 권한 | 컨테이너 실행 사용자와 NFS 디렉터리 소유권·권한이 맞아야 파일을 쓸 수 있음 |
| 접근 모드 | 여러 노드가 함께 써야 할 때만 RWX를 선택하고, 스토리지가 지원하는지 확인 |
| 회수 정책 | `Retain`이면 PVC 삭제 뒤 데이터가 남으므로 정리 절차를 마련 |
| 동시 쓰기 | 여러 Pod가 같은 파일을 수정할 때 애플리케이션에서 잠금·이름 분리 등을 고려 |

NFS는 파일 공유가 필요한 상황에 유용하지만, 모든 상태 저장 애플리케이션에 자동으로 적합한 것은 아니다. 데이터베이스처럼 지연 시간, 잠금 방식, 장애 복구 요구가 엄격한 워크로드는 해당 데이터베이스가 권장하는 스토리지와 배포 방식을 먼저 확인해야 한다.

---

## 6. 정리

NFS PV는 여러 노드의 Pod가 네트워크를 통해 같은 디렉터리를 사용할 수 있게 해 준다. NFS 서버를 준비한 뒤 PV에 서버 주소와 공유 경로를 등록하고, PVC를 `Bound` 상태로 만든 다음 Pod가 그 PVC를 참조하는 순서다.

여러 Pod가 함께 써야 한다면 RWX 지원 여부와 파일 권한을 먼저 확인한다. 또한 PVC를 삭제해도 데이터가 남도록 `Retain` 정책을 선택했다면, 데이터 보존과 정리 책임도 함께 운영해야 한다.

---

## 참고 자료

* [Kubernetes 문서 - Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
* [Kubernetes 문서 - Volumes](https://kubernetes.io/docs/concepts/storage/volumes/)
