---
layout: post
title: "Kubernetes (15) - StatefulSet으로 고정된 Pod 식별자와 스토리지 관리하기"
date: 2026-08-30 16:33:07 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "statefulset", "pod", "headless-service", "persistent-volume", "storage", "rolling-update", "쿠버네티스"]
---

## 1. StatefulSet이 필요한 이유

Deployment와 ReplicaSet은 같은 사양의 Pod를 여러 개 실행하고 개수를 유지하는 데 적합하다. 하지만 데이터베이스나 메시지 브로커처럼 각 복제본이 고유한 이름, 네트워크 주소, 디스크 데이터를 가져야 하는 애플리케이션에는 Pod를 서로 바꿔도 되는 방식이 맞지 않는다.

StatefulSet은 각 Pod에 **고정된 순번과 이름**, **안정적인 네트워크 식별자**, **Pod별 영속 스토리지**를 제공하는 워크로드 리소스다. Pod가 삭제되어 새로 만들어져도 `sf-nginx-0`처럼 같은 순번의 이름을 유지하고, 설정한 PVC를 다시 연결할 수 있다.

---

## 2. StatefulSet Pod의 고유한 정체성

`replicas: 3`으로 `sf-nginx` StatefulSet을 만들면 Pod는 다음처럼 생성된다.

```text
sf-nginx-0
sf-nginx-1
sf-nginx-2
```

끝의 숫자를 ordinal(순번)이라고 한다. 기본적으로 `0`부터 `replicas - 1`까지 부여되며, StatefulSet은 이를 기준으로 Pod를 식별한다.

| 구분 | Deployment | StatefulSet |
| --- | --- | --- |
| Pod 이름 | 임의의 접미사가 붙어 교체될 때 달라짐 | `<StatefulSet 이름>-<순번>` 형태로 유지 |
| Pod 간 관계 | 대체로 서로 교환 가능 | 각 Pod가 고유한 정체성을 가짐 |
| 네트워크 | 일반적으로 Service 뒤의 공통 접근점 | Pod별 고정 DNS 이름 사용 가능 |
| 스토리지 | 별도 설정 필요 | `volumeClaimTemplates`로 Pod별 PVC 생성 가능 |
| 적합한 대상 | 상태가 없는 웹 애플리케이션 | DB, 메시지 브로커, 분산 저장소 |

실습에서 `kubectl describe pod sf-nginx-0`를 실행하면 다음과 같은 라벨과 소유 관계를 확인할 수 있다.

```text
Labels:
  app=webui
  apps.kubernetes.io/pod-index=0
  controller-revision-hash=sf-nginx-85cd44ddd9
  statefulset.kubernetes.io/pod-name=sf-nginx-0
Controlled By:  StatefulSet/sf-nginx
```

`apps.kubernetes.io/pod-index=0`과 `statefulset.kubernetes.io/pod-name=sf-nginx-0`는 이 Pod가 0번 복제본임을 보여 준다. Pod를 삭제해도 StatefulSet은 `sf-nginx-0`이라는 이름의 대체 Pod를 생성한다. 다만 Pod UID와 IP는 새로 바뀔 수 있다.

---

## 3. Headless Service로 Pod별 DNS 만들기

StatefulSet의 `serviceName`은 Pod의 네트워크 도메인을 결정한다. 이 이름과 같은 **Headless Service**를 사용자가 먼저 만들어야 Pod별 DNS 이름을 안정적으로 사용할 수 있다.

```yaml
# sf-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: sf-service
spec:
  clusterIP: None
  selector:
    app: webui
  ports:
    - name: http
      port: 80
      targetPort: 80
```

`clusterIP: None`은 이 Service가 단일 가상 IP로 로드 밸런싱하지 않는 Headless Service임을 뜻한다. 기본 네임스페이스와 기본 클러스터 도메인에서는 각 Pod를 다음 형식으로 조회할 수 있다.

```text
sf-nginx-0.sf-service.default.svc.cluster.local
sf-nginx-1.sf-service.default.svc.cluster.local
sf-nginx-2.sf-service.default.svc.cluster.local
```

즉 `sf-service`는 모든 Pod를 하나로 숨기는 일반 Service가 아니라, StatefulSet Pod가 각자의 DNS 이름을 갖도록 도와주는 역할을 한다.

---

## 4. NGINX StatefulSet 매니페스트

다음 예제는 `sf-service`를 네트워크 도메인으로 사용하고 NGINX Pod 세 개를 생성한다. 제공된 실습 예제의 `podManagementPolicy: Parallel`을 그대로 사용했다.

```yaml
# statefulset-exam.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: sf-nginx
spec:
  serviceName: sf-service
  replicas: 3
  podManagementPolicy: Parallel
  selector:
    matchLabels:
      app: webui
  template:
    metadata:
      labels:
        app: webui
    spec:
      containers:
        - name: nginx-container
          image: nginx:1.14
          ports:
            - containerPort: 80
```

`selector.matchLabels`와 `template.metadata.labels`는 일치해야 한다. StatefulSet의 selector는 생성 후 변경할 수 없으므로, 다른 컨트롤러와 겹치지 않는 라벨을 정해야 한다.

위 매니페스트는 Pod 이름과 DNS 식별자는 제공하지만 영속 스토리지는 만들지 않는다. 실제 상태 저장 애플리케이션에는 `volumeClaimTemplates`를 추가해 Pod마다 별도의 PVC를 만들어야 한다.

```yaml
volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 1Gi
```

컨테이너에는 이 PVC를 `volumeMounts`로 연결한다. 예를 들어 `sf-nginx-0`에는 `data-sf-nginx-0`, `sf-nginx-1`에는 `data-sf-nginx-1`처럼 Pod별 PVC가 생성된다. StatefulSet을 축소하거나 삭제해도 이 PVC와 연결된 볼륨은 기본적으로 자동 삭제되지 않으므로, 데이터 보존과 정리 정책을 별도로 결정해야 한다.

---

## 5. OrderedReady와 Parallel의 차이

StatefulSet은 Pod의 고유한 정체성은 유지하면서, 생성·종료 순서를 `podManagementPolicy`로 선택할 수 있다.

| 정책 | 동작 | 적합한 경우 |
| --- | --- | --- |
| `OrderedReady` | `0`부터 순서대로 만들고, 이전 Pod가 Ready가 된 뒤 다음 Pod를 생성한다. 축소 시에는 큰 순번부터 종료한다. 기본값이다. | 순서 있는 초기화와 기동이 필요한 클러스터 |
| `Parallel` | Pod 생성·종료 시 다른 Pod의 Ready·종료를 기다리지 않고 병렬로 처리한다. | 순서는 중요하지 않지만 Pod별 이름·스토리지는 필요한 경우 |

실습 매니페스트는 `Parallel`을 사용하므로 `sf-nginx-0`, `sf-nginx-1`, `sf-nginx-2`가 동시에 생성될 수 있다. 병렬 정책도 Pod 이름, DNS, PVC의 고유성은 유지한다. 다만 분산 데이터베이스처럼 시작 순서가 중요한 애플리케이션에는 기본값인 `OrderedReady`가 더 적합할 수 있다.

---

## 6. 생성, Pod 복구, 스케일 조정

Headless Service와 StatefulSet을 순서대로 적용한다.

```bash
kubectl apply -f sf-service.yaml
kubectl apply -f statefulset-exam.yaml
kubectl get sts
kubectl get pods -l app=webui
```

관리 중인 0번 Pod를 삭제하면 StatefulSet은 같은 순번을 가진 Pod를 다시 만든다.

```bash
kubectl delete pod sf-nginx-0
kubectl get pods -l app=webui --watch
```

새 Pod는 `sf-nginx-0`이라는 이름을 유지하지만, 재생성된 Pod이므로 이전 Pod와 IP는 다를 수 있다. `volumeClaimTemplates`를 사용했다면 0번 Pod에 연결된 기존 PVC를 다시 사용한다.

복제본 수는 `scale` 명령 또는 매니페스트의 `spec.replicas`로 변경한다.

```bash
kubectl scale sts sf-nginx --replicas=4
kubectl scale sts sf-nginx --replicas=2
kubectl scale sts sf-nginx --replicas=3
```

4개로 확장하면 `sf-nginx-3`이 추가되고, 2개로 축소하면 높은 순번의 Pod가 제거되어 `sf-nginx-0`, `sf-nginx-1`만 남는다. `Parallel` 정책에서는 이 과정이 병렬로 진행될 수 있다.

---

## 7. 업데이트와 롤백

컨테이너 이미지처럼 `spec.template`을 변경하면 StatefulSet의 기본 전략인 `RollingUpdate`가 동작한다. 기본 정책에서는 가장 큰 ordinal부터 하나씩 Pod를 교체하고, 새 Pod가 Ready가 된 뒤 다음 Pod를 업데이트한다.

```bash
kubectl set image sts/sf-nginx nginx-container=nginx:1.15
kubectl rollout status sts/sf-nginx
```

실습에서도 이미지 변경 뒤 `sf-nginx-0`을 조회하면 `nginx:1.15`가 실행 중인 것을 확인할 수 있다.

배포 이력을 보고 이전 리비전으로 되돌릴 수 있다.

```bash
kubectl rollout history sts/sf-nginx
kubectl rollout undo sts/sf-nginx
kubectl rollout status sts/sf-nginx
```

특정 리비전으로 되돌릴 때는 `--to-revision`을 지정한다.

```bash
kubectl rollout undo sts/sf-nginx --to-revision=2
```

잘못된 이미지처럼 새 Pod가 Ready 상태가 될 수 없는 설정으로 업데이트하면, `OrderedReady` StatefulSet의 롤아웃은 해당 Pod에서 멈출 수 있다. 템플릿을 이전 정상 설정으로 되돌린 뒤에도 문제가 된 Pod를 직접 삭제해야 복구가 진행될 수 있으므로, 운영 환경에서는 `kubectl rollout status`로 진행 상태를 반드시 확인한다.

---

## 8. 정리

StatefulSet은 `sf-nginx-0`처럼 고정된 Pod 이름과 순번을 제공하며, Headless Service를 통해 Pod별 DNS 이름을 구성한다. `volumeClaimTemplates`를 사용하면 Pod마다 분리된 영속 볼륨을 연결할 수 있어, DB·메시지 브로커·분산 저장소 같은 상태 저장 애플리케이션을 관리하는 데 적합하다.

이번 실습처럼 `scale`, Pod 삭제, `rollout undo`를 실행해 보면 Pod 이름은 유지하면서도 컨트롤러가 복구·확장·업데이트를 수행하는 방식을 확인할 수 있다. 다만 StatefulSet을 삭제하거나 축소해도 PVC가 기본적으로 남는다는 점을 기억하고, 데이터 보존 정책을 명확히 세워야 한다.

---

## 참고 자료

* [StatefulSets | Kubernetes 공식 문서](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
