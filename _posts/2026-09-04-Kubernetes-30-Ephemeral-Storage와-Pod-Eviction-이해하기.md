---
layout: post
title: "Kubernetes (30) - Ephemeral Storage와 Pod Eviction 이해하기"
date: 2026-09-04 08:39:43 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "ephemeral-storage", "eviction", "emptydir", "resources", "kubelet", "쿠버네티스"]
---

컨테이너는 파일을 쓸 수 있다. 로그 파일, 압축 해제 파일, 임시 캐시처럼 컨테이너가 사용하는 로컬 디스크도 결국 Kubernetes 노드의 디스크 공간을 차지한다.

이런 임시 디스크 사용량을 관리하는 리소스가 `ephemeral-storage`다. 데이터를 오래 보존하는 PV와 PVC의 저장소가 아니라, Pod가 실행되는 동안 노드 로컬에 생기는 파일 공간을 관리한다.

---

## 1. Ephemeral Storage는 어떤 파일을 포함할까?

일반적인 로컬 ephemeral storage 사용량에는 다음이 포함된다.

| 대상 | 예시 |
| --- | --- |
| 컨테이너 쓰기 가능 레이어 | 컨테이너 안에서 애플리케이션이 만든 임시 파일 |
| 컨테이너 로그 | 표준 출력·표준 오류가 노드에 기록된 로그 |
| 디스크 기반 `emptyDir` | 같은 Pod의 컨테이너가 공유하는 임시 디렉터리 |

`emptyDir`라도 `medium: Memory`로 설정했다면 디스크가 아니라 메모리 기반 `tmpfs`를 사용한다. 이 경우에는 ephemeral storage가 아니라 Pod의 메모리 사용량에 영향을 준다.

영구 보관해야 하는 데이터는 PV·PVC 같은 영속 스토리지에 저장해야 한다. 반면 재시작 시 없어져도 되는 캐시, 변환 중간 파일, 임시 로그 버퍼는 ephemeral storage 관리 대상이 될 수 있다.

---

## 2. 디스크 요청량과 제한량을 지정한다

CPU·메모리와 마찬가지로 컨테이너 `resources` 아래에 `ephemeral-storage`를 작성한다.

```yaml
# sample-ephemeral-storage.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-ephemeral-storage
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["/bin/sh", "-c", "sleep 3600"]
      resources:
        requests:
          # 스케줄러가 이만큼의 로컬 임시 디스크를 고려한다.
          ephemeral-storage: 256Mi
        limits:
          # 컨테이너가 사용할 수 있는 로컬 임시 디스크의 상한이다.
          ephemeral-storage: 512Mi
```

```bash
kubectl apply -f sample-ephemeral-storage.yaml
kubectl get pod sample-ephemeral-storage
```

`requests.ephemeral-storage`는 Pod를 배치할 때 노드가 수용할 수 있는지 판단하는 데 쓰인다. `limits.ephemeral-storage`는 컨테이너의 쓰기 레이어·로그 등 로컬 임시 저장소 사용량이 커질 때 보호 기준이 된다.

다만 실제 사용량 측정과 제한 적용은 노드의 kubelet 설정과 파일 시스템 구성에 의존한다. 운영 클러스터에서는 작은 테스트 Pod로 제한과 관측이 기대대로 동작하는지 먼저 확인하는 편이 좋다.

---

## 3. 제한을 넘으면 Pod가 축출될 수 있다

학습 환경에서는 다음처럼 컨테이너 안에 큰 임시 파일을 만들어 볼 수 있다.

```bash
kubectl exec sample-ephemeral-storage -- \
  sh -c 'dd if=/dev/zero of=/tmp/large-file bs=1M count=600'

kubectl get pod sample-ephemeral-storage
kubectl describe pod sample-ephemeral-storage
```

위 예제는 `512Mi` 제한보다 큰 파일을 만들려고 한다. kubelet이 로컬 ephemeral storage 사용량을 측정하는 환경이라면 Pod가 종료되거나 `Evicted` 상태가 될 수 있다. 결과는 노드 설정과 파일 시스템 구성에 따라 달라질 수 있으므로, `describe pod`의 Events를 반드시 확인한다.

Pod 전체 관점에서도 제한을 생각해야 한다. 하나의 Pod에 컨테이너가 여러 개라면 각 컨테이너의 ephemeral storage 제한이 합쳐진다. 또한 디스크 기반 `emptyDir`을 여러 컨테이너가 함께 사용하면, 그 사용량은 Pod의 로컬 임시 디스크 사용량에 함께 반영된다.

---

## 4. Eviction은 노드를 보호하기 위한 축출이다

노드의 메모리나 디스크가 심각하게 부족해지면 kubelet은 노드 전체가 멈추는 일을 피하기 위해 일부 Pod를 축출할 수 있다. 이를 **Eviction**이라고 한다.

```text
노드의 메모리·디스크 여유 공간 감소
              ↓
kubelet이 압박 상태(node pressure) 감지
              ↓
우선순위와 사용량 등을 고려해 일부 Pod Eviction
              ↓
노드가 최소한의 정상 동작 여유를 회복
```

Eviction은 애플리케이션이 명시한 `limits`만 보고 일어나는 기능이 아니다. 노드 자체의 메모리·디스크 여유 공간이 임계값 아래로 내려갔을 때도 발생할 수 있다. 일반적으로 요청량보다 많이 사용 중인 Pod, 우선순위가 낮은 Pod 등이 더 먼저 축출 대상이 될 수 있다.

클러스터는 kubelet, 컨테이너 런타임, 운영체제가 사용할 자원도 남겨 두어야 한다. 그래서 노드의 총 CPU·메모리·디스크를 모두 Pod에 배정할 수 있는 것은 아니다. 시스템 예약과 Eviction 임계값은 클러스터 운영자가 노드 특성에 맞춰 관리한다.

---

## 5. 임시 파일은 용도에 맞는 저장소에 둔다

| 파일의 성격 | 권장 위치 |
| --- | --- |
| Pod가 사라져도 남아야 하는 데이터 | PV·PVC 같은 영속 스토리지 |
| 같은 Pod의 컨테이너가 잠시 공유하는 파일 | 디스크 기반 `emptyDir` |
| 빠르지만 사라져도 되는 작은 데이터 | `medium: Memory`를 사용한 `emptyDir` |
| 대량 로그 | 로그 수집 정책과 보존 저장소를 함께 설계 |

대량 로그나 임시 파일을 컨테이너 파일 시스템에 무제한으로 쌓아 두는 것은 위험하다. 로그 로테이션, 외부 로그 수집, `emptyDir.sizeLimit`, `ephemeral-storage` 요청·제한을 함께 검토한다.

---

## 6. 정리

`ephemeral-storage`는 컨테이너의 쓰기 레이어, 로그, 디스크 기반 `emptyDir`처럼 노드 로컬에 잠시 생기는 파일 공간을 관리한다. 영구 데이터용 PV·PVC와 역할이 다르다는 점이 핵심이다.

노드가 메모리나 디스크 부족 상태가 되면 kubelet은 전체 노드를 보호하기 위해 Pod를 Eviction할 수 있다. 임시 데이터의 크기를 예상하고, 중요한 데이터는 처음부터 영속 스토리지에 두는 설계가 필요하다.

---

## 참고 자료

* [Kubernetes 문서 - 로컬 Ephemeral Storage 관리](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#local-ephemeral-storage)
* [Kubernetes 문서 - 노드 압박 상태의 Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/)
