---
layout: post
title: "Kubernetes (11) - ReplicationController로 원하는 Pod 수 유지하기"
date: 2026-08-29 23:15:19 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "pod", "replicationcontroller", "replicas", "label", "selector", "쿠버네티스"]
---

Pod를 직접 여러 개 만들면 Pod 하나가 삭제되거나 노드 장애로 사라졌을 때 원하는 개수를 직접 다시 맞춰야 한다. ReplicationController는 선언한 수만큼 같은 Pod가 실행되도록 감시하고, 부족하면 새 Pod를 만들어 원하는 상태를 유지한다.

이번 글에서는 `rc-nginx` 예제를 바탕으로 ReplicationController의 구성 요소, 레이블과 selector의 관계, 상태 확인과 스케일 조정 방법을 정리한다.

---

## 1. ReplicationController란?

ReplicationController(RC)는 지정한 수의 동일한 Pod 복제본이 항상 실행되도록 관리하는 컨트롤러다. Pod 수가 `replicas`보다 적으면 Pod를 생성하고, 많으면 초과 Pod를 종료한다. 관리 대상 Pod가 삭제되거나 종료되면 대체 Pod를 만들어 복제본 수를 맞춘다.

RC는 한 노드의 프로세스만 감시하는 프로세스 관리자가 아니라, 여러 노드에 걸친 Pod 집합을 관리한다고 이해할 수 있다. 예제처럼 3개의 Nginx Pod를 만들면 스케줄러의 판단에 따라 서로 다른 워커 노드에 배치될 수 있다.

다만 ReplicationController는 현재 수평 확장 워크로드를 위한 **레거시 API**다. 새 애플리케이션은 더 유연한 레이블 선택자를 지원하고 Deployment가 관리하는 ReplicaSet을 사용하는 것이 권장된다. RC는 기존 구성의 이해·유지보수나 학습 목적으로 알아둘 가치가 있다.

---

## 2. `rc-nginx` 매니페스트 작성하기

다음 매니페스트는 `app: webui` 레이블을 가진 Nginx Pod 3개를 유지한다. `selector`는 RC가 관리할 Pod를 찾는 조건이고, `template.metadata.labels`는 RC가 새로 만드는 Pod에 붙일 레이블이다. 두 값은 반드시 일치해야 한다.

```yaml
# rc-nginx.yaml
apiVersion: v1
kind: ReplicationController
metadata:
  name: rc-nginx
spec:
  # 유지할 Pod 개수
  replicas: 3
  # 이 레이블을 가진 Pod를 관리 대상으로 선택
  selector:
    app: webui
  # Pod가 부족할 때 사용할 Pod 설계도
  template:
    metadata:
      name: nginx-pod
      labels:
        # selector와 반드시 일치해야 함
        app: webui
    spec:
      containers:
        - name: nginx-container
          image: nginx:1.14
```

RC가 직접 만든 Pod뿐 아니라 selector와 일치하는 다른 Pod도 관리 대상으로 볼 수 있다는 점에 주의해야 한다. 다른 컨트롤러나 독립 Pod에 `app: webui`를 무심코 붙이면 RC가 복제본 수를 맞추려고 예상하지 못한 Pod를 삭제하거나, 새 Pod 생성을 멈출 수 있다.

---

## 3. Pod 3개 생성과 상태 확인

매니페스트를 적용하면 RC가 Pod 템플릿을 사용해 3개의 Pod를 만든다.

```bash
kubectl apply -f rc-nginx.yaml

# ReplicationController 목록 확인
kubectl get replicationcontrollers
kubectl get rc
```

예제의 출력처럼 `DESIRED`, `CURRENT`, `READY`가 모두 3이면 원하는 복제본 수와 현재 실행·준비된 Pod 수가 일치한다.

```text
NAME       DESIRED   CURRENT   READY   AGE
rc-nginx   3         3         3       3m6s
```

Pod 생성 과정을 계속 관찰하려면 다음 명령을 사용한다.

```bash
watch -n 2 kubectl get pods -o wide
```

`-o wide` 출력에서는 Pod IP와 배치된 노드를 함께 볼 수 있다. 위 실습에서는 `rc-nginx-*` Pod가 서로 다른 워커 노드에 분산되어 실행됐지만, RC 자체가 Pod 분산을 보장하는 것은 아니다. 실제 배치는 스케줄러와 노드의 자원·스케줄링 정책에 따라 결정된다.

---

## 4. 레이블과 이벤트로 관리 상태 확인하기

RC의 selector, 현재 복제본 수, Pod 템플릿과 Pod 생성 이벤트는 `describe` 명령으로 확인한다.

```bash
kubectl describe rc rc-nginx
kubectl get pod --show-labels
kubectl get pods -l app=webui
```

`kubectl describe rc rc-nginx`에서는 다음 정보를 확인할 수 있다.

| 항목 | 예제 값 | 의미 |
| --- | --- | --- |
| `Selector` | `app=webui` | RC가 관리할 Pod를 찾는 조건 |
| `Replicas` | `3 current / 3 desired` | 현재 수와 원하는 수 |
| `Pods Status` | `3 Running` | 관리 대상 Pod의 상태 요약 |
| `SuccessfulCreate` 이벤트 | Pod 이름 | RC가 Pod를 만들었음을 뜻함 |

Pod 하나를 삭제해도 RC는 다시 3개를 맞추기 위해 새 Pod를 만든다. 이 동작을 확인하려면 관리 대상 Pod 하나를 삭제한 뒤 Pod 목록을 관찰한다.

```bash
kubectl delete pod <rc가-관리하는-pod-이름>
watch -n 2 kubectl get pods -l app=webui
```

삭제된 Pod와 이름이 다른 새 Pod가 생성되면, RC가 선언한 상태를 복구한 것이다. 컨테이너 내부 프로세스 재시작은 노드의 kubelet이 담당하고, Pod 자체가 사라졌을 때 복제본을 새로 만드는 일은 RC가 담당한다.

---

## 5. 복제본 수 변경하기

복제본 수는 매니페스트의 `spec.replicas`를 바꿔 다시 적용하거나, 다음처럼 `scale` 명령으로 조정할 수 있다.

```bash
# 원하는 Pod 수를 5개로 변경
kubectl scale rc rc-nginx --replicas=5

kubectl get rc rc-nginx
kubectl get pods -l app=webui
```

대화형으로 설정을 확인·수정해야 한다면 다음 명령을 사용한다.

```bash
kubectl edit rc rc-nginx
```

`kubectl edit`에서 `spec.replicas`를 수정해 저장하면 RC가 추가 Pod를 만들거나 초과 Pod를 줄인다. 다만 운영 환경에서는 변경 이력을 남기고 재현하기 쉽도록 YAML 파일을 수정한 뒤 `kubectl apply`하는 방식을 우선 사용하는 편이 좋다.

| 작업 | 명령 | 결과 |
| --- | --- | --- |
| 상태 조회 | `kubectl get rc` | desired·current·ready 확인 |
| 상세 조회 | `kubectl describe rc rc-nginx` | selector·이벤트·Pod 템플릿 확인 |
| 확장·축소 | `kubectl scale rc rc-nginx --replicas=5` | 원하는 Pod 수 변경 |
| 매니페스트 수정 | `kubectl edit rc rc-nginx` | 리소스를 직접 편집 |

---

## 6. ReplicationController와 ReplicaSet·Deployment 비교

RC의 핵심 역할은 Pod 개수 유지다. 그러나 새 워크로드에서는 ReplicaSet과 Deployment가 일반적인 선택이다.

| 리소스 | Pod 수 유지 | 레이블 선택자 | 업데이트·롤백 |
| --- | --- | --- | --- |
| ReplicationController | 가능 | equality 기반 선택자 | 직접 조합해 관리 |
| ReplicaSet | 가능 | equality·set 기반 선택자 | 보통 Deployment가 관리 |
| Deployment | ReplicaSet을 통해 가능 | ReplicaSet 사용 | 롤링 업데이트·롤백 지원 |

컨테이너 이미지를 포함한 Pod 템플릿을 안전하게 바꾸고 배포 이력·롤백을 관리해야 한다면 Deployment를 사용한다. RC의 Pod 템플릿을 수정해도 기존 Pod가 자동으로 새 템플릿과 일치하도록 교체되지는 않으므로, 현대적인 애플리케이션 배포에는 Deployment가 더 적합하다.

---

## 7. 정리

ReplicationController는 selector와 일치하는 Pod 수가 `replicas`와 같도록 계속 조정한다. `rc-nginx` 예제에서는 `app: webui` 레이블을 기준으로 Nginx Pod 3개를 만들고, Pod가 사라져도 새 Pod를 생성해 원하는 상태를 복구한다.

`kubectl get rc`, `kubectl describe rc`, `kubectl get pods --show-labels`, `kubectl scale`을 사용하면 RC의 복제본 상태와 레이블, 생성 이벤트, 확장·축소 결과를 확인할 수 있다. 다만 RC는 레거시 API이므로 새 서비스는 Deployment와 ReplicaSet을 기본 선택지로 삼는 것이 좋다.

---

## 참고 자료

* [Kubernetes 문서 - ReplicationController](https://kubernetes.io/docs/concepts/workloads/controllers/replicationcontroller/)
