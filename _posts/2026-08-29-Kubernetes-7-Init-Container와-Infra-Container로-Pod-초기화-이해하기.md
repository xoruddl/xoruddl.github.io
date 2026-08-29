---
layout: post
title: "Kubernetes (7) - Init Container와 Infra Container로 Pod 초기화 이해하기"
date: 2026-08-29 17:00:48 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "pod", "init-container", "infra-container", "pause-container", "쿠버네티스"]
---

Pod가 시작될 때 애플리케이션 컨테이너만 바로 실행되는 것은 아니다. 필요한 네트워크와 볼륨을 준비한 뒤, 애플리케이션 실행 전의 작업이 있다면 Init Container가 이를 먼저 처리한다.

이번 글에서는 Pod 명세에 직접 작성하는 Init Container와 컨테이너 런타임이 Pod 실행 환경을 만들 때 사용하는 Infra Container를 구분하고, Init Container를 실제로 구성하고 확인하는 방법을 정리한다.

---

## 1. Pod 시작 과정에서 각 구성 요소의 역할

Pod가 노드에 배치되면 kubelet은 컨테이너 런타임과 협력해 Pod sandbox를 만들고 네트워크를 구성하며 볼륨을 마운트한다. 이후 Init Container가 있다면 정의된 순서대로 실행하고, 모두 성공적으로 끝난 뒤에야 앱 컨테이너를 시작한다.

```text
Pod 스케줄링
  → Pod sandbox·네트워크·볼륨 준비
  → Init Container 1 완료
  → Init Container 2 완료
  → 앱 컨테이너 시작
```

여기서 Init Container와 Infra Container는 모두 "앱 컨테이너보다 먼저 보이는 구성"이라는 점 때문에 혼동하기 쉽다. 하지만 Init Container는 개발자가 Pod 명세에 선언하는 일회성 작업이고, Infra Container는 런타임이 Pod의 공용 실행 환경을 유지하기 위해 내부적으로 만드는 구성이다.

| 구분 | Init Container | Infra Container / Pod sandbox |
| --- | --- | --- |
| 누가 정의하는가 | Pod의 `spec.initContainers`에 직접 작성 | kubelet과 컨테이너 런타임이 생성 |
| 주된 역할 | 앱 시작 전 준비 작업 수행 | Pod의 네트워크·네임스페이스 같은 실행 환경 준비 |
| 실행 시점 | sandbox 준비 후, 앱 컨테이너 전에 순차 실행 | 컨테이너 생성 전에 준비 |
| 종료 시점 | 작업 성공 후 종료 | 보통 Pod 수명 동안 유지 |
| 대표 예 | 설정 파일 생성, 의존 서비스 확인, 데이터 준비 | `pause` 이미지 기반의 sandbox 구현 |

---

## 2. Init Container란?

Init Container는 앱 컨테이너가 시작되기 전에 실행되는 특수한 컨테이너다. 하나 이상 정의할 수 있으며, 여러 개일 때는 병렬이 아니라 선언한 순서대로 실행된다. 앞선 Init Container가 성공적으로 완료되지 않으면 다음 Init Container와 앱 컨테이너는 시작하지 않는다.

일반 컨테이너와 마찬가지로 별도 이미지, 명령, 환경 변수, 볼륨, 보안 설정을 가질 수 있다. 다만 일반적인 Init Container는 작업을 끝내고 종료하는 것이 목적이므로 `lifecycle`, `livenessProbe`, `readinessProbe`, `startupProbe`를 설정할 수 없다.

다음과 같은 상황에 적합하다.

* 앱 이미지에 넣고 싶지 않은 도구로 초기 설정을 생성할 때
* 서비스 이름 해석이나 외부 의존성처럼 앱의 시작 조건을 확인할 때
* 공유 볼륨에 설정 파일이나 초기 데이터를 준비할 때
* 초기화 작업에만 더 높은 권한이나 별도의 Secret 접근 권한이 필요할 때

앱 컨테이너가 아직 실행되지 않았으므로, Init Container는 시작 순서를 보장하는 간단한 장치가 된다. 반면 단순한 `sleep`으로 외부 시스템을 기다리기보다는 재시도 횟수와 실패 기준을 명확히 두거나, 앱 자체의 재시도 로직도 함께 고려하는 편이 안전하다.

---

## 3. Service DNS를 확인한 뒤 앱 시작하기

앱이 다른 서비스에 의존한다면, Init Container로 필요한 Service의 DNS 이름을 확인한 뒤 앱 컨테이너를 시작하게 할 수 있다. 먼저 아래처럼 `myservice`와 `mydb` Service를 만든다. 이 예제의 목적은 DNS 이름 해석을 확인하는 것이므로, Service에 selector를 넣지 않았다.

```yaml
# service.yaml
---
apiVersion: v1
kind: Service
metadata:
  name: myservice
spec:
  ports:
    - protocol: TCP
      port: 80
      targetPort: 9376
---
apiVersion: v1
kind: Service
metadata:
  name: mydb
spec:
  ports:
    - protocol: TCP
      port: 80
      targetPort: 9377
```

다음 Pod의 Init Container는 현재 네임스페이스를 서비스 어카운트 토큰이 마운트된 경로에서 읽고, FQDN 형식으로 두 Service를 차례로 조회한다. `myservice`가 해석될 때까지 첫 번째 Init Container가 반복되고, 성공한 뒤에만 `mydb`를 확인하는 두 번째 Init Container가 실행된다. 두 단계가 모두 끝나야 `myapp-container`가 시작된다.

```yaml
# myapp-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp-pod
  labels:
    app.kubernetes.io/name: MyApp
spec:
  containers:
    - name: myapp-container
      image: busybox:1.28
      command: ['sh', '-c', 'echo The app is running! && sleep 3600']
  initContainers:
    - name: init-myservice
      image: busybox:1.28
      command: ['sh', '-c', "until nslookup myservice.$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace).svc.cluster.local; do echo waiting for myservice; sleep 2; done"]
    - name: init-mydb
      image: busybox:1.28
      command: ['sh', '-c', "until nslookup mydb.$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace).svc.cluster.local; do echo waiting for mydb; sleep 2; done"]
```

```bash
kubectl apply -f service.yaml
kubectl apply -f myapp-pod.yamlcat /var/lib/kubelet/config.yaml

staticPodPath: /etc/kubernetes/manifests
staticPodPath 를 수정할 수도 있음

root@cka-control-plane:~/k8s_core_labs/4# cd /etc/kubernetes/manifests/
root@cka-control-plane:/etc/kubernetes/manifests# ls
etcd.yaml  kube-apiserver.yaml  kube-controller-manager.yaml  kube-scheduler.yaml
root@cka-control-plane:/etc/kubernetes/manifests# 

# Init Container와 앱 컨테이너의 상태를 함께 확인
kubectl get pod myapp-pod
kubectl describe pod myapp-pod

# 각 Init Container의 로그 확인
kubectl logs myapp-pod -c init-myservice
kubectl logs myapp-pod -c init-mydb
```

`kubectl describe pod`의 `Init Containers`와 이벤트를 보면 초기화가 어느 단계에서 멈췄는지 확인할 수 있다. 상태 정보는 `.status.initContainerStatuses`에도 기록되므로 자동화 도구에서 초기화 성공 여부를 확인할 때 활용할 수 있다.

단, `nslookup` 성공은 **Service의 DNS 레코드가 준비되었음**만 뜻한다. 이 예제처럼 selector가 없는 Service에는 엔드포인트가 생성되지 않으므로 실제 연결 가능 여부는 확인하지 않는다. 실제 의존 서비스가 요청을 처리할 준비까지 보장해야 한다면, 앱의 재시도 로직·readinessProbe·별도의 헬스 체크를 함께 설계해야 한다.

---

## 4. 실패, 재시작, 리소스 요청 시 주의할 점

Init Container가 실패하면 kubelet은 Pod의 `restartPolicy`에 따라 성공할 때까지 다시 시도한다. `restartPolicy: Never`인 Pod에서 초기화가 실패하면 Pod 전체가 실패한 것으로 처리된다. 초기화 코드는 재실행될 수 있으므로, 이미 파일이나 데이터가 존재해도 안전하게 동작하도록 멱등하게 작성해야 한다.

리소스 요청량도 미리 검토해야 한다. Kubernetes는 여러 Init Container의 요청량 중 가장 큰 값을 초기화 단계의 유효 요청량으로 잡고, 앱 컨테이너들의 요청량 합계와 비교해 더 큰 값을 Pod 스케줄링에 사용한다. 짧게 실행되는 초기화 작업이라도 큰 CPU·메모리를 요청하면 Pod가 실행되는 내내 그만큼의 자원 예약이 필요할 수 있다.

| 확인 항목 | 권장 사항 |
| --- | --- |
| 재실행 | 파일 생성·마이그레이션 작업은 여러 번 실행되어도 안전하게 작성 |
| 실패 처리 | 무한 대기를 피하고 재시도 횟수와 종료 조건을 설정 |
| 보안 | 초기화에만 필요한 도구·권한·Secret은 앱 컨테이너와 분리 |
| 리소스 | Init Container의 가장 큰 요청량이 스케줄링에 미치는 영향 확인 |

---

## 5. Infra Container는 무엇인가?

교육 자료나 런타임 화면에서 말하는 Infra Container는 Pod의 환경을 만들어 주는 컨테이너를 가리키는 관용적인 표현이다. 전통적으로 Docker 기반 Kubernetes 환경에서는 `pause` 컨테이너가 먼저 실행되어 Pod의 네트워크 네임스페이스 등을 유지했고, 이 때문에 `pause container` 또는 `infra container`라고 불렸다.

현재 Kubernetes는 CRI(Container Runtime Interface)를 통해 런타임에 **Pod sandbox** 생성을 요청한다. sandbox의 구체적인 구현은 런타임에 따라 달라질 수 있으므로, 모든 환경에서 사용자가 `pause`라는 이름의 컨테이너를 직접 보게 되는 것은 아니다. 핵심은 앱 컨테이너들이 같은 Pod sandbox 안에서 네트워크 환경을 공유한다는 점이다.

따라서 Infra Container는 `initContainers`에 작성하거나 애플리케이션 코드로 제어하는 대상이 아니다. 다음 명령으로 보이는 컨테이너 목록과 구현 세부 사항은 사용 중인 런타임과 도구에 따라 다를 수 있다.

```bash
# Pod에 할당된 IP와 노드 확인
kubectl get pod myapp-pod -o wide

# Pod 이벤트와 컨테이너 상태 확인
kubectl describe pod myapp-pod
```

Pod의 네트워크·스토리지 준비가 끝나면 `PodReadyToStartContainers` 조건이 설정되고, Init Container가 있는 Pod는 그 뒤에 초기화 단계를 거친다. 모든 Init Container가 끝나면 `Initialized` 조건이 `True`가 되고 앱 컨테이너가 시작된다.

---

## 6. Init Container, Sidecar, Infra Container 비교

세 구성은 역할과 수명주기가 다르므로, 목적에 맞춰 구분해야 한다.

| 구분 | Init Container | Sidecar Container | Infra Container |
| --- | --- | --- | --- |
| 목적 | 앱 시작 전 준비 작업 | 앱 실행 중 보조 기능 제공 | Pod 공용 실행 환경 유지 |
| 앱과 함께 계속 실행 | 아니오 | 예 | 보통 예 |
| Pod 명세에 작성 | 예 | 예 | 아니오 |
| 예시 | 설정 생성, 데이터 준비 | 로그 전달, 프록시 | Pod sandbox, `pause` 구현 |

로그 수집이나 프록시처럼 앱 실행 중에도 계속 동작해야 하는 기능은 Sidecar를 고려한다. 반대로 완료 시점이 분명한 준비 작업은 Init Container로 분리한다. Infra Container는 이 둘을 실행할 공통 기반을 제공하는 런타임의 개념으로 이해하면 된다.

---

## 7. 정리

Init Container는 앱 컨테이너가 시작되기 전에 필요한 준비 작업을 순차적으로 완료하게 하는 Pod 명세의 기능이다. 설정 생성, 의존성 확인, 초기 데이터 준비처럼 앱 이미지와 분리하고 싶은 시작 작업에 유용하다. 실패와 재실행을 고려해 멱등하게 작성하고, 리소스 요청량과 권한 범위를 함께 점검해야 한다.

Infra Container는 사용자가 선언하는 초기화 작업이 아니다. 컨테이너 런타임이 Pod sandbox를 만들며 Pod의 네트워크와 실행 환경을 준비하는 구현 개념이다. Init Container는 sandbox가 준비된 뒤 앱 시작 전에 실행되며, 두 개념을 구분하면 Pod의 시작 과정을 더 정확히 이해할 수 있다.

---

## 참고 자료

* [Kubernetes 문서 - 초기화 컨테이너](https://kubernetes.io/ko/docs/concepts/workloads/pods/init-containers/)
* [Kubernetes 문서 - Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
