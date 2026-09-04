---
layout: post
title: "Kubernetes (33) - Cluster Autoscaler로 노드 자동 확장 이해하기"
date: 2026-09-04 08:39:43 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "cluster-autoscaler", "node-autoscaling", "hpa", "scheduling", "cloud", "쿠버네티스"]
---

HPA가 부하에 맞춰 Pod 수를 늘려도, 모든 노드에 빈자리가 없다면 새 Pod는 실행되지 못하고 `Pending` 상태에 남는다. 이때 필요한 것은 Pod가 아니라 **Pod를 실행할 노드**를 늘리는 일이다.

Cluster Autoscaler는 스케줄되지 못한 Pod와 노드의 사용 상황을 바탕으로 노드 그룹의 크기를 조절하는 기능이다. Kubernetes만으로 새 서버가 생기는 것은 아니며, 클라우드의 노드 그룹이나 온프레미스의 머신 관리 도구와 연결되어야 한다.

---

## 1. HPA와 Cluster Autoscaler의 역할은 다르다

두 기능은 모두 이름에 Autoscaler가 있지만, 확장하는 대상이 다르다.

| 기능 | 늘리거나 줄이는 대상 | 주로 보는 신호 |
| --- | --- | --- |
| HPA | Deployment 등의 Pod 복제본 수 | CPU·메모리·사용자 정의 지표 |
| Cluster Autoscaler | 워커 노드 수 | 스케줄되지 못한 Pod, 노드 축소 가능 여부 |

```text
트래픽 증가
   ↓
HPA가 Deployment의 Pod 수 증가
   ↓
새 Pod의 requests를 수용할 노드가 없음
   ↓
Pod가 Pending 상태
   ↓
Cluster Autoscaler가 노드 그룹 확장 요청
   ↓
새 노드가 클러스터에 참여하고 Pending Pod 배치
```

Cluster Autoscaler는 단순히 노드 CPU 사용률 평균이 높다는 이유만으로 노드를 늘리는 기능으로 이해하면 안 된다. 핵심 신호는 **현재 클러스터에 배치할 수 없는 Pod가 있는가**다. 그래서 Pod의 `requests` 설정은 노드 자동 확장에서도 중요한 기준이 된다.

---

## 2. Pending Pod가 노드 확장의 출발점이다

다음처럼 Pod가 `Pending` 상태가 되었을 때 먼저 스케줄링 실패 원인을 확인한다.

```bash
kubectl get pods
kubectl describe pod <pending-pod-name>
```

Events에 CPU·메모리 부족처럼 노드 추가로 해결할 수 있는 이유가 나타나면, Cluster Autoscaler는 확장 가능한 노드 그룹이 있는지 검토한다. 반대로 아래와 같은 경우에는 노드를 추가해도 해결되지 않을 수 있다.

| Pending 원인 | 노드 추가만으로 해결되는가? |
| --- | --- |
| CPU·메모리 요청량을 수용할 노드가 없음 | 확장 가능한 적절한 노드 그룹이 있다면 가능 |
| 이미지 가져오기 실패 | 불가능. 이미지·레지스트리 문제 해결 필요 |
| PVC가 Bound되지 않음 | 보통 불가능. 스토리지 조건 확인 필요 |
| nodeSelector·taint·affinity 조건 불일치 | 해당 조건을 만족하는 노드 그룹이 있어야 가능 |

따라서 `Pending`이라는 상태만 보지 말고, 항상 Events의 구체적인 사유를 확인해야 한다.

---

## 3. Kubernetes 밖의 노드 생성 시스템이 필요하다

Cluster Autoscaler는 노드를 직접 가상 머신으로 만들어 주는 서버 프로비저너가 아니다. 노드 그룹의 최소·최대 크기를 조절할 수 있는 인프라와 연결해 확장 요청을 보낸다.

| 환경 | 일반적인 연결 대상 |
| --- | --- |
| 관리형 클라우드 Kubernetes | 클라우드 제공자의 노드 그룹·Auto Scaling Group·Managed Node Group |
| 직접 구축한 가상 머신 환경 | VM 생성 뒤 kubeadm join 등을 자동화하는 머신 관리 체계 |
| Kubernetes 표준에 가까운 머신 수명 주기 관리 | Cluster API(CAPI) 기반 인프라 프로바이더 |

예를 들어 클라우드에서는 노드 그룹의 최소값·최대값과 인스턴스 유형을 먼저 정의한다. Cluster Autoscaler는 허용 범위 안에서 노드 그룹의 원하는 크기를 바꾸고, 클라우드가 새 인스턴스를 만든 뒤 노드가 클러스터에 등록되는 흐름으로 동작한다.

노드가 추가되기까지는 VM 생성, 부팅, Kubernetes 구성 요소 시작, 클러스터 등록 시간이 필요하다. 따라서 수 초 안에 해결되는 Pod 확장과 달리 노드 확장은 보통 더 긴 시간을 예상해야 한다.

---

## 4. 노드 축소도 안전하게 수행해야 한다

부하가 줄었다고 모든 노드를 즉시 삭제할 수 있는 것은 아니다. Cluster Autoscaler는 사용률이 낮은 노드에서 Pod를 다른 노드로 옮길 수 있는지 검토한 뒤, 비어 있거나 축소 가능한 노드를 제거하려고 한다.

다음 조건은 축소를 막거나 복잡하게 만들 수 있다.

| 확인할 점 | 이유 |
| --- | --- |
| PodDisruptionBudget(PDB) | 동시에 중단될 수 있는 Pod 수를 제한할 수 있음 |
| 로컬 스토리지·특수 노드 조건 | 다른 노드로 옮기기 어려울 수 있음 |
| DaemonSet | 모든 노드에 있어야 하는 Pod는 일반 애플리케이션 Pod와 다르게 취급 |
| 노드 그룹 최소 크기 | 설정한 최소 노드 수 아래로는 줄지 않음 |

중요한 상태 저장 워크로드는 축소 과정에서 Pod가 이동하거나 재시작될 수 있다는 점을 고려해, PDB와 스토리지 구성을 먼저 점검해야 한다.

---

## 5. requests 값을 현실적으로 정한다

Cluster Autoscaler는 실제 순간 CPU 사용량보다 Pod가 요청한 `requests`를 바탕으로 새 노드가 필요한지 판단한다. 그래서 리소스 값을 임의로 정하면 다음 문제가 생길 수 있다.

| 설정 문제 | 발생할 수 있는 결과 |
| --- | --- |
| `requests`가 실제 필요량보다 너무 큼 | 배치 가능한 Pod 수가 줄어 노드를 과도하게 늘릴 수 있음 |
| `requests`가 실제 필요량보다 너무 작음 | 새 노드가 필요하다고 판단하지 못해 노드 과밀·성능 저하가 생길 수 있음 |
| `limits`만 크게 설정 | 스케줄러와 자동 확장의 주된 기준은 requests이므로 기대와 다를 수 있음 |

처음부터 완벽한 값을 맞히기보다, 관측과 부하 테스트를 통해 `requests`를 현실적인 수준으로 조정한다. HPA의 목표 사용률, 노드 인스턴스 크기, 노드 그룹 최대 크기도 함께 검토해야 한다.

---

## 6. 정리

Cluster Autoscaler는 Pod 수가 아니라 노드 수를 조절한다. HPA가 새 Pod를 만들고, 그 Pod가 `requests` 때문에 어느 노드에도 배치될 수 없을 때 노드 확장이 이어지는 흐름을 이해하는 것이 핵심이다.

운영 환경에서는 클라우드 또는 VM 관리 시스템과의 연동, 노드 그룹의 최소·최대 크기, 안전한 축소 정책이 모두 필요하다. 자동 확장은 매니페스트 하나로 끝나는 기능이 아니므로, 사용 중인 인프라 제공자의 설치·운영 문서를 함께 확인해 구성한다.

---

## 참고 자료

* [Kubernetes 문서 - Node Autoscaling](https://kubernetes.io/docs/concepts/cluster-administration/node-autoscaling/)
* [Kubernetes Autoscaler 프로젝트 - Cluster Autoscaler](https://github.com/kubernetes/autoscaler/tree/master/cluster-autoscaler)
