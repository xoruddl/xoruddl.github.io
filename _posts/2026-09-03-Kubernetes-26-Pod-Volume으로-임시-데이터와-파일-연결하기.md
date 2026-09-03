---
layout: post
title: "Kubernetes (26) - Pod Volume으로 임시 데이터와 파일 연결하기"
date: 2026-09-03 22:03:12 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "volume", "emptydir", "hostpath", "downward-api", "projected-volume", "storage", "쿠버네티스"]
---

컨테이너 안에서 만든 파일은 별도 저장소를 연결하지 않았다면 컨테이너의 파일 시스템 안에 저장된다. 컨테이너가 교체되거나 Pod가 다시 만들어질 때 이 파일을 그대로 기대하면 안 된다.

하지만 모든 파일을 오래 보관할 필요는 없다. 캐시나 작업 중간 결과처럼 잠깐만 필요한 파일도 있다. Kubernetes의 Pod Volume은 이런 파일을 컨테이너에 제공하는 방법을 통일된 방식으로 다룬다.

이번 글에서는 Pod와 함께 사용할 임시 파일 공간, 노드 파일 연결, Pod 정보를 파일로 전달하는 방법을 살펴본다. Pod가 없어져도 데이터를 보존해야 하는 PV와 PVC는 다음 글에서 다룬다.

---

## 1. Volume은 컨테이너에 파일을 연결한다

Volume은 컨테이너에 연결하는 외부 파일 공간이라고 생각하면 쉽다. Pod 매니페스트에서는 두 부분을 함께 작성한다.

| 설정 | 의미 |
| --- | --- |
| `volumes` | 어떤 종류의 파일 공간을 사용할지 정의 |
| `volumeMounts` | 그 파일 공간을 컨테이너 안의 어느 경로에서 사용할지 지정 |

두 설정은 같은 `name`으로 연결된다. 즉 `volumes`에서 만든 `cache-volume`을 `volumeMounts`에서 찾아 `/cache` 경로에 붙이는 구조다.

```text
Pod
├─ volumes: cache-volume을 emptyDir로 정의
│
└─ 컨테이너
   └─ volumeMounts: cache-volume을 /cache에 마운트
```

Pod Volume에는 여러 종류가 있다. 처음에는 아래 네 가지의 용도만 구분해도 충분하다.

| 종류 | 주된 용도 | Pod 삭제 뒤 |
| --- | --- | --- |
| `emptyDir` | 같은 Pod 안 컨테이너 간 임시 파일 공유 | 데이터 삭제 |
| `hostPath` | 노드의 특정 파일·디렉터리 접근 | 노드 경로에 데이터가 남을 수 있음 |
| `downwardAPI` | Pod 이름·라벨·리소스 요청값 전달 | 마운트 삭제 |
| `projected` | Secret·ConfigMap·Downward API 등을 한 경로에 모음 | 마운트 삭제 |

ConfigMap과 Secret도 파일로 마운트할 수 있으므로 Volume source의 한 종류다. Pod를 삭제하면 마운트는 사라지지만, ConfigMap과 Secret 리소스 자체는 남는다.

---

## 2. `emptyDir`로 Pod의 임시 파일 공간 만들기

`emptyDir`는 Pod가 시작될 때 비어 있는 디렉터리로 만들어지는 임시 볼륨이다. 같은 Pod 안의 여러 컨테이너가 이 디렉터리를 함께 사용할 수 있다. 예를 들어 앱 컨테이너가 `/cache`에 임시 파일을 쓰고, 보조 컨테이너가 같은 파일을 읽는 상황에 쓸 수 있다.

컨테이너 하나만 재시작되면 `emptyDir`의 파일은 남는다. 하지만 Pod 자체가 삭제되면 파일도 삭제된다. 그래서 캐시, 변환 중간 파일, 컨테이너 간 파일 교환에 적합하고, 반드시 보존해야 하는 데이터에는 맞지 않는다.

아래 예제는 `cache-volume`이라는 `emptyDir`를 만들고 컨테이너의 `/cache`에 마운트한다.

```yaml
# sample-emptydir.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-emptydir
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["/bin/sh", "-c", "echo cached-at-startup > /cache/message && sleep 3600"]
      volumeMounts:
        # 아래에서 정의한 cache-volume을 컨테이너의 /cache에 연결한다.
        - name: cache-volume
          mountPath: /cache
  volumes:
    # Pod가 살아 있는 동안만 유지되는 빈 디렉터리를 만든다.
    - name: cache-volume
      emptyDir: {}
```

```bash
kubectl apply -f sample-emptydir.yaml
kubectl exec sample-emptydir -- cat /cache/message
kubectl exec sample-emptydir -- df -h /cache
```

`/cache/message`가 보이면 Volume 연결에 성공한 것이다. 기본 `emptyDir`는 노드의 로컬 임시 저장 공간을 사용한다. `sizeLimit`을 지정하면 이 볼륨이 사용할 수 있는 크기를 제한할 수 있다.

```yaml
emptyDir:
  sizeLimit: 128Mi
```

메모리 기반 임시 파일이 필요하다면 `medium: Memory`를 지정한다. 이 경우 `emptyDir`는 `tmpfs`를 사용하며, 기록한 데이터는 Pod의 메모리 사용량에 영향을 준다. 대용량 캐시를 무심코 메모리에 두면 메모리 부족으로 Pod가 종료될 수 있으므로, 용도와 크기를 함께 고려해야 한다.

```yaml
emptyDir:
  medium: Memory
  sizeLimit: 64Mi
```

---

## 3. `hostPath`는 노드의 파일을 직접 연결한다

`hostPath`에서 host는 Kubernetes **노드 컴퓨터**를 뜻한다. 즉 `hostPath`는 Pod가 실행 중인 노드의 파일이나 디렉터리를 컨테이너에 그대로 연결한다. 예를 들어 노드 로그를 수집하는 에이전트가 노드의 `/var/log`를 읽어야 할 때 사용할 수 있다.

```yaml
# sample-hostpath.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-hostpath
spec:
  containers:
    - name: log-reader
      image: busybox:1.36
      command: ["/bin/sh", "-c", "ls /host/var/log && sleep 3600"]
      volumeMounts:
        - name: node-logs
          # 노드의 /var/log를 컨테이너 안 /host/var/log에서 읽는다.
          mountPath: /host/var/log
          readOnly: true
  volumes:
    - name: node-logs
      hostPath:
        path: /var/log
        # 해당 경로가 디렉터리로 이미 존재해야 Pod가 시작한다.
        type: Directory
```

`hostPath.type`으로 경로의 기대 형태를 지정할 수 있다.

| 값 | 동작 |
| --- | --- |
| `Directory` | 지정한 디렉터리가 이미 있어야 함 |
| `DirectoryOrCreate` | 없으면 kubelet이 디렉터리를 생성 |
| `File` | 지정한 파일이 이미 있어야 함 |
| `FileOrCreate` | 없으면 kubelet이 빈 파일을 생성 |
| `Socket`, `CharDevice`, `BlockDevice` | Unix 소켓·디바이스 유형을 확인 |

이 예제에서 컨테이너의 `/host/var/log`와 노드의 `/var/log`는 같은 파일을 가리킨다. 다만 `hostPath`는 일반적인 애플리케이션의 영구 저장소로 적합하지 않다. Pod가 노드 A에서 노드 B로 이동하면 노드 B에는 노드 A의 파일이 없을 수 있기 때문이다.

또한 호스트의 민감한 경로를 쓰기 가능하게 마운트하면 컨테이너가 노드 전체에 영향을 줄 수 있다. 꼭 필요한 시스템 에이전트 용도로만 사용하고, 파일을 읽기만 하면 되는 경우에는 반드시 `readOnly: true`를 지정한다.

---

## 4. Downward API와 projected 볼륨

애플리케이션이 자신의 Pod 이름이나 Namespace를 알아야 하는 경우가 있다. 이때 애플리케이션이 Kubernetes API에 직접 요청하도록 만들 필요는 없다. Downward API를 사용하면 Kubernetes가 알고 있는 일부 Pod·컨테이너 정보를 환경 변수나 파일로 전달할 수 있다.

아래 예제는 Pod 이름과 CPU 요청량을 `/etc/podinfo` 아래의 파일로 전달한다. `fieldRef`는 Pod 이름처럼 Pod 자체의 정보를, `resourceFieldRef`는 CPU 요청량처럼 컨테이너 리소스 설정을 가리킨다. 컨테이너는 일반 파일을 읽듯 `cat` 명령으로 이 값을 확인할 수 있다.

```yaml
# sample-downward-api.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-downward-api
  labels:
    app: demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["/bin/sh", "-c", "cat /etc/podinfo/pod-name; cat /etc/podinfo/cpu-request; sleep 3600"]
      resources:
        requests:
          cpu: 100m
      volumeMounts:
        - name: pod-info
          mountPath: /etc/podinfo
          readOnly: true
  volumes:
    - name: pod-info
      downwardAPI:
        items:
          - path: pod-name
            fieldRef:
              fieldPath: metadata.name
          - path: cpu-request
            resourceFieldRef:
              containerName: app
              resource: requests.cpu
```

```bash
kubectl apply -f sample-downward-api.yaml
kubectl exec sample-downward-api -- ls /etc/podinfo
kubectl exec sample-downward-api -- cat /etc/podinfo/pod-name
kubectl exec sample-downward-api -- cat /etc/podinfo/cpu-request
```

`projected` 볼륨은 여러 원본을 하나의 디렉터리에 모으는 기능이다. 예를 들어 ConfigMap의 설정 파일, Secret의 인증 정보, Downward API의 Pod 정보를 `/etc/app` 아래에 함께 배치할 수 있다. 여러 파일을 한 경로에서 관리하고 싶을 때 사용하며, ConfigMap과 Secret은 Pod와 같은 Namespace에 있어야 한다.

```yaml
volumes:
  - name: app-files
    projected:
      sources:
        - configMap:
            name: sample-app-config
        - secret:
            name: sample-db-auth
        - downwardAPI:
            items:
              - path: pod-name
                fieldRef:
                  fieldPath: metadata.name
```

---

## 5. 정리

Pod Volume은 컨테이너에 파일을 제공하는 공통 인터페이스다. `volumes`에서 파일 공간을 정의하고 `volumeMounts`에서 컨테이너 경로에 연결한다.

Pod 수명 동안만 필요한 캐시와 중간 파일에는 `emptyDir`를 사용한다. 노드 로그처럼 특별히 노드 파일을 읽어야 할 때만 `hostPath`를 사용하며, Pod 이름 같은 정보를 파일로 전달하려면 Downward API를 사용한다. Pod가 없어져도 데이터를 보존하는 PV와 PVC는 다음 글에서 다룬다.

---

## 참고 자료

* [Kubernetes 문서 - Volumes](https://kubernetes.io/docs/concepts/storage/volumes/)
* [Kubernetes 문서 - Ephemeral Volumes](https://kubernetes.io/docs/concepts/storage/ephemeral-volumes/)
* [Kubernetes 문서 - Downward API](https://kubernetes.io/docs/concepts/workloads/pods/downward-api/)
* [Kubernetes 문서 - Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/)
