---
layout: post
title: "Kubernetes (31) - LimitRange와 ResourceQuota로 네임스페이스 정책 만들기"
date: 2026-09-04 08:39:43 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "limitrange", "resourcequota", "namespace", "resources", "governance", "쿠버네티스"]
---

앞 글에서 컨테이너마다 `requests`와 `limits`를 직접 설정했다. 하지만 팀원이 많아지면 누군가 설정을 빠뜨리거나, 지나치게 큰 값을 넣는 일을 매번 리뷰만으로 막기 어렵다.

`LimitRange`와 `ResourceQuota`는 네임스페이스 단위로 기본값과 총량 규칙을 적용하는 리소스다. `LimitRange`는 **개별 Pod·컨테이너의 규칙**, `ResourceQuota`는 **네임스페이스 전체 예산**을 담당한다고 구분하면 이해하기 쉽다.

---

## 1. 두 리소스의 역할을 구분한다

| 리소스 | 적용 범위 | 해결하는 문제 |
| --- | --- | --- |
| `LimitRange` | 컨테이너·Pod·PVC 하나 | 기본 요청량, 최소·최대값, limit/request 비율 강제 |
| `ResourceQuota` | 네임스페이스 전체 | 모든 리소스의 총 사용량과 생성 개수 제한 |

예를 들어 `LimitRange`는 컨테이너가 최소 `100m` CPU를 요청하도록 만들 수 있다. `ResourceQuota`는 이 네임스페이스 전체에서 요청할 수 있는 CPU 합계를 `2`로 제한할 수 있다.

두 리소스 모두 **새로 생성하거나 갱신하는 리소스**에 대한 admission 제어다. 정책을 만든 뒤에도 이미 실행 중인 Pod의 리소스 값이 자동으로 바뀌지는 않는다.

---

## 2. LimitRange로 기본값과 허용 범위를 정한다

먼저 실습 전용 네임스페이스를 만든다.

```yaml
# resource-demo-namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: resource-demo
```

다음 `LimitRange`는 컨테이너의 CPU·메모리 기본값과 최소·최대값을 정한다.

```yaml
# sample-limitrange.yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: sample-container-limits
  namespace: resource-demo
spec:
  limits:
    - type: Container
      # resources를 생략한 컨테이너에 적용할 기본 limits
      default:
        cpu: 500m
        memory: 512Mi
      # resources를 생략한 컨테이너에 적용할 기본 requests
      defaultRequest:
        cpu: 250m
        memory: 256Mi
      max:
        cpu: "1"
        memory: 1Gi
      min:
        cpu: 100m
        memory: 128Mi
      # limits가 requests의 두 배를 넘지 못하게 한다.
      maxLimitRequestRatio:
        cpu: "2"
        memory: "2"
```

```bash
kubectl apply -f resource-demo-namespace.yaml
kubectl apply -f sample-limitrange.yaml
kubectl describe limitrange sample-container-limits -n resource-demo
```

아무 리소스 설정 없이 Pod를 만들면 `default`와 `defaultRequest`가 자동으로 추가된다.

```yaml
# sample-defaulted-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-defaulted-pod
  namespace: resource-demo
spec:
  containers:
    - name: nginx
      image: nginx:1.27
```

```bash
kubectl apply -f sample-defaulted-pod.yaml
kubectl get pod sample-defaulted-pod -n resource-demo \
  -o jsonpath='{.spec.containers[0].resources}'
echo
```

`min`보다 작은 요청량, `max`보다 큰 제한량, `maxLimitRequestRatio`를 넘는 비율을 지정하면 Pod 생성이 거부된다. 이 덕분에 잘못된 매니페스트를 실행 전에 발견할 수 있다.

---

## 3. ResourceQuota로 네임스페이스 전체 예산을 정한다

이번에는 `resource-demo` 네임스페이스에서 사용할 수 있는 총량과 생성 개수를 제한한다.

```yaml
# sample-resourcequota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: sample-team-quota
  namespace: resource-demo
spec:
  hard:
    # 모든 컨테이너 requests의 합계
    requests.cpu: "2"
    requests.memory: 2Gi
    # 모든 컨테이너 limits의 합계
    limits.cpu: "4"
    limits.memory: 4Gi
    # 만들 수 있는 API 리소스 수
    count/configmaps: "10"
    count/services: "5"
    pods: "10"
```

```bash
kubectl apply -f sample-resourcequota.yaml
kubectl describe resourcequota sample-team-quota -n resource-demo
```

`kubectl describe` 결과에는 다음 두 열이 보인다.

| 항목 | 의미 |
| --- | --- |
| `Used` | 현재 네임스페이스에서 사용 중인 양 또는 개수 |
| `Hard` | 새 리소스 생성을 허용하는 최대 양 또는 개수 |

예를 들어 모든 Pod의 CPU 요청량 합계가 `2`에 도달하면, CPU 요청을 더하는 새 Pod는 생성되지 않는다. 같은 방식으로 ConfigMap을 10개 만든 상태에서는 11번째 ConfigMap 생성이 거부된다.

---

## 4. LimitRange와 ResourceQuota는 함께 사용한다

ResourceQuota에 `requests.cpu`, `limits.memory` 같은 컴퓨팅 리소스 총량을 설정한 네임스페이스에서는, 새 컨테이너가 해당 요청·제한을 명시해야 할 수 있다. 이때 LimitRange의 기본값을 함께 두면 사용자가 매번 모든 값을 작성하지 않아도 된다.

```text
개발자가 Pod 생성 요청
          ↓
LimitRange가 기본값 추가·최소/최대값 검사
          ↓
ResourceQuota가 네임스페이스의 남은 총량 검사
          ↓
조건을 만족하면 Pod 생성
```

다만 기본값은 팀의 실제 워크로드에 맞게 정해야 한다. 너무 큰 기본 `requests`는 작은 작업도 배치하기 어렵게 만들고, 너무 작은 값은 노드 과밀과 성능 문제를 숨길 수 있다.

---

## 5. 정리

`LimitRange`는 개별 컨테이너와 Pod가 지켜야 하는 기본값·최소값·최대값을 정하고, `ResourceQuota`는 네임스페이스 전체가 사용할 수 있는 총 리소스와 객체 수를 제한한다.

두 정책을 함께 사용하면 리소스 설정 누락을 줄이고, 한 팀이나 서비스가 클러스터 자원을 모두 사용하는 상황을 예방할 수 있다. 다음 글에서는 이렇게 설정한 CPU 요청량을 기준으로 Pod 수를 자동 조절하는 HPA를 살펴본다.

---

## 참고 자료

* [Kubernetes 문서 - LimitRange](https://kubernetes.io/docs/concepts/policy/limit-range/)
* [Kubernetes 문서 - ResourceQuota](https://kubernetes.io/docs/concepts/policy/resource-quotas/)
