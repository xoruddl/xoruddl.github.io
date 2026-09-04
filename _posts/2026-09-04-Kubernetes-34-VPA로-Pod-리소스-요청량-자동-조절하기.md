---
layout: post
title: "Kubernetes (34) - VPA로 Pod 리소스 요청량 자동 조절하기"
date: 2026-09-04 16:42:07 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "vpa", "vertical-pod-autoscaler", "autoscaling", "resources", "requests", "쿠버네티스"]
---

앞 글에서 HPA는 부하에 따라 Pod **개수**를 조절한다고 살펴봤다. 하지만 Pod의 CPU·메모리 `requests` 자체가 실제 워크로드에 맞지 않으면, Pod가 불필요하게 많이 배치되지 않거나 반대로 자원을 낭비할 수 있다.

Vertical Pod Autoscaler(VPA)는 컨테이너의 실제 사용량을 관찰해 CPU와 메모리 `requests`의 권장값을 계산하고, 설정에 따라 적용하는 기능이다. 실행 중인 컨테이너에 CPU·메모리를 즉시 더하는 기능으로 이해하기보다, **적절한 요청량을 추천하고 설정에 따라 Pod를 교체하거나 제자리에서 반영하는 도구**로 이해하는 것이 좋다.

---

## 1. VPA는 Pod의 크기를 조절한다

HPA와 VPA는 자동 확장이라는 공통점이 있지만, 바꾸는 대상과 판단 기준이 다르다.

| 기능 | 조절 대상 | 주된 목적 |
| --- | --- | --- |
| HPA | Pod 복제본 수 | 요청량·처리량 변화에 맞춰 처리 용량 조절 |
| VPA | 컨테이너의 CPU·메모리 `requests` | 실제 사용 패턴에 맞춰 Pod당 자원 크기 조절 |
| Cluster Autoscaler | 워커 노드 수 | 스케줄되지 못한 Pod를 수용할 노드 확보 |

예를 들어 항상 CPU `50m`, 메모리 `64Mi`를 요청하는 Nginx Pod가 실제로는 더 많은 메모리를 꾸준히 사용한다면, VPA는 관측 데이터를 바탕으로 더 현실적인 요청량을 제안한다. 이렇게 조정한 `requests`는 스케줄러와 Cluster Autoscaler의 판단에도 직접 영향을 준다.

---

## 2. VPA 구성 요소와 설치 상태를 확인한다

VPA를 사용하려면 클러스터에 VPA API와 컨트롤러가 준비되어 있어야 한다. 관리형 Kubernetes에서는 제공 방식이 다를 수 있고, 직접 구축한 환경에서는 Kubernetes Autoscaler 프로젝트의 매니페스트 또는 배포 도구로 설치한다.

VPA는 일반적으로 다음 구성 요소로 동작한다.

| 구성 요소 | 역할 |
| --- | --- |
| Recommender | 사용량 이력을 분석해 권장 CPU·메모리 값을 계산 |
| Updater | 적용이 필요한 Pod를 판단하고 교체를 요청 |
| Admission Controller | 새로 생성되는 Pod에 VPA 권장값을 반영 |

설치 뒤에는 CRD와 구성 요소가 있는지 확인한다.

```bash
kubectl get crd | grep verticalpodautoscalers
kubectl get pods -n kube-system
```

실제 설치 명령과 네임스페이스는 배포판 및 설치 방법에 따라 다를 수 있다. 특히 운영 클러스터에서는 VPA 버전, Kubernetes 버전, 권한과 Pod 교체 영향을 먼저 검토한다.

---

## 3. 작은 requests를 가진 Deployment에 VPA를 적용한다

다음은 작은 CPU·메모리 요청량으로 시작하는 Deployment 예시다.

```yaml
# nginx-vpa-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-vpa
spec:
  replicas: 2
  selector:
    matchLabels:
      app: nginx-vpa
  template:
    metadata:
      labels:
        app: nginx-vpa
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

먼저 권장값만 확인하도록 VPA를 만든다. 처음에는 `Off` 모드로 충분한 관측 기간을 두는 편이 안전하다.

```yaml
# nginx-vpa.yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: nginx-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-vpa
  updatePolicy:
    updateMode: "Off"
```

```bash
kubectl apply -f nginx-vpa-deployment.yaml
kubectl apply -f nginx-vpa.yaml
kubectl describe vpa nginx-vpa
```

VPA는 사용량 이력을 쌓아야 하므로, 생성 직후에는 유의미한 권장값이 없을 수 있다. 실서비스와 비슷한 요청을 발생시킨 뒤 충분한 시간을 두고 관찰한다.

---

## 4. 권장값과 UpdateMode를 읽는다

`kubectl describe vpa nginx-vpa`의 `Recommendation`에서 컨테이너별 권장 범위를 볼 수 있다.

| 항목 | 의미 |
| --- | --- |
| `Lower Bound` | 권장 범위의 하한. 이보다 낮으면 성능 저하 위험을 검토해야 함 |
| `Target` | VPA가 `requests`로 적용하려는 대표 권장값 |
| `Uncapped Target` | 정책 제한을 적용하기 전, 관측 사용량을 기준으로 계산한 값 |
| `Upper Bound` | 권장 범위의 상한. 이보다 크게 잡으면 자원 낭비 가능성을 검토 |

업데이트 방식은 다음처럼 선택한다.

| `updateMode` | 동작 |
| --- | --- |
| `Off` | Pod를 바꾸지 않고 권장값만 제공 |
| `Initial` | 새로 생성되는 Pod에만 권장값 반영 |
| `Recreate` | 필요할 때 기존 Pod를 교체해 권장값 반영 |
| `InPlaceOrRecreate` | 가능하면 실행 중인 Pod의 자원을 제자리에서 변경하고, 불가능하면 Pod 교체 |
| `InPlace` | 제자리 변경만 시도. 기능 게이트와 지원 버전이 필요할 수 있음 |

기존 예제에서 자주 보이는 `Auto`는 현재 `Recreate`의 별칭이며 최신 VPA에서는 사용 중단(deprecated) 상태다. 어떤 자동 업데이트 방식이든 Pod 교체가 일어날 수 있으므로, 단일 복제본 서비스나 중단에 민감한 워크로드에 바로 적용하면 안 된다. 운영 환경에서는 보통 `Off`로 추천값을 먼저 검토하고, PodDisruptionBudget과 복제본 수를 준비한 뒤 적용 범위를 넓힌다.

---

## 5. HPA와 함께 쓸 때는 같은 기준을 피한다

CPU 사용률 기반 HPA는 CPU `requests` 대비 사용률로 확장 여부를 계산한다. VPA가 같은 CPU `requests`를 바꾸면 HPA의 사용률 기준도 함께 바뀌므로 두 컨트롤러가 서로의 판단에 영향을 줄 수 있다.

| HPA 기준 | VPA 조절 대상 | 권장 여부 |
| --- | --- | --- |
| CPU 사용률 | CPU | 피하는 편이 좋음 |
| CPU 사용률 | 메모리 | 목적과 워크로드를 검토한 뒤 가능 |
| 외부 요청 수·큐 길이 | CPU·메모리 | 두 기능의 판단 기준이 분리되어 비교적 적합 |

HPA와 VPA를 함께 사용해야 한다면 HPA는 요청 수나 큐 길이 같은 외부 지표를, VPA는 CPU·메모리 요청량을 맡기는 구성이 충돌을 줄인다. 어떤 경우든 부하 테스트와 관측으로 실제 반응을 먼저 확인한다.

---

## 6. 정리

VPA는 컨테이너의 CPU·메모리 `requests`를 관측 기반으로 추천하고, 설정에 따라 새 Pod에 반영하는 자동화 도구다. 요청량을 한 번 정한 뒤 방치하기보다, 실제 서비스의 사용 패턴으로 점검하는 데 특히 유용하다.

처음에는 `Off` 모드로 `Target` 권장값을 관찰하고, 재생성으로 인한 영향과 HPA의 지표 기준을 검토한 뒤 자동 적용을 선택한다. 다음 글에서는 Pod가 정상 실행 중인지와 트래픽을 받을 준비가 되었는지를 판단하는 Probe를 살펴본다.

---

## 참고 자료

* [Kubernetes 문서 - Vertical Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/vertical-pod-autoscale/)
* [Kubernetes Autoscaler 프로젝트 - Vertical Pod Autoscaler](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler)
