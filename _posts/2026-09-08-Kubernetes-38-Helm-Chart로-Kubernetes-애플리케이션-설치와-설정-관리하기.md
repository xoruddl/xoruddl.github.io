---
layout: post
title: "Kubernetes (38) - Helm Chart로 Kubernetes 애플리케이션 설치와 설정 관리하기"
date: 2026-09-08 12:38:00 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "helm", "chart", "manifest", "mariadb", "쿠버네티스"]
---

Nginx나 MariaDB를 Kubernetes에 직접 설치하려면 Deployment, Service, Secret, PVC처럼 여러 YAML 파일이 필요하다. Helm은 이 YAML 묶음을 재사용 가능한 패키지로 만들어, 한 명령으로 설치하고 설정을 바꾸고 이전 버전으로 되돌릴 수 있게 한다.

처음에는 Helm을 “Kubernetes용 앱 스토어와 설치 기록을 함께 관리하는 도구”라고 생각하면 이해하기 쉽다. 이 글에서는 공개 Chart를 설치하는 가장 기본적인 흐름부터 `values.yaml`로 설정을 바꾸는 방법까지 살펴본다.

---


## 1. Helm에서 꼭 알아야 할 네 가지

Helm을 처음 사용할 때는 Chart와 Release의 차이만 분명히 알아도 충분하다.

```text
Chart(설치 패키지) + values(내 설정)
                │
                ▼
         Kubernetes YAML 생성
                │
                ▼
Release(클러스터에 실제로 설치된 결과)
```

| 용어 | 쉽게 말하면 | 예시 |
| --- | --- | --- |
| Helm | 패키지를 설치·업데이트·삭제하는 도구 | `helm install` 명령 |
| Chart | 설치에 필요한 YAML과 기본 설정을 담은 패키지 | `bitnami/nginx` |
| values | Chart의 기본값 중 내가 바꾸고 싶은 값 | Pod 개수, Service 타입 |
| Release | 내 클러스터에 설치된 Chart 한 건 | `web`이라는 이름으로 설치한 Nginx |

같은 Nginx Chart라도 `web-dev`, `web-prod`처럼 다른 이름과 설정으로 여러 번 설치할 수 있다. 이때 각각이 별도의 Release가 된다.

이 글은 Helm과 `kubectl`이 설치되어 있고, `kubectl get nodes`가 실행되는 환경을 가정한다. Helm 설치가 끝났는지는 다음 명령으로 확인한다.

```bash
helm version
```

---

## 2. Chart를 찾기 전에 Repository를 등록한다

Chart Repository는 Chart 패키지를 모아 둔 저장소다. Helm에 Repository 주소를 한 번 등록하면 그 뒤에는 패키지 이름으로 Chart를 검색하고 설치할 수 있다.

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

Repository를 추가했으면 Nginx와 MariaDB Chart가 있는지 검색한다.

```bash
helm repo list
helm search repo bitnami/nginx
helm search repo bitnami/mariadb --versions
```

검색 결과에서 Chart 이름과 버전을 먼저 확인한다. 설치 전에는 해당 Chart가 바꿀 수 있는 설정 목록도 살펴본다.

```bash
helm show values bitnami/nginx
```

출력되는 YAML이 길어 보여도 모두 외울 필요는 없다. 처음에는 `replicaCount`, `service`, `resources`, `persistence`, `auth`처럼 지금 바꾸려는 항목만 검색해서 읽으면 된다. Chart마다 설정 키가 다르고 같은 Chart도 버전에 따라 달라질 수 있으므로, 블로그 예제보다 이 명령의 결과를 우선한다.

---

## 3. 가장 간단하게 Nginx를 설치해 본다

다음 명령은 `bitnami/nginx` Chart를 `web`이라는 이름으로 `demo` 네임스페이스에 설치한다.

```bash
helm install web bitnami/nginx \
  --namespace demo \
  --create-namespace \
  --wait
```

각 부분의 의미는 다음과 같다.

| 부분 | 의미 |
| --- | --- |
| `web` | 이번 설치 결과(Release)의 이름 |
| `bitnami/nginx` | 설치할 Chart의 Repository 이름과 Chart 이름 |
| `--namespace demo` | 리소스를 만들 네임스페이스 |
| `--create-namespace` | `demo`가 없으면 함께 생성 |
| `--wait` | Pod 등이 준비될 때까지 명령이 기다림 |

설치가 끝났다고 바로 정상 동작을 뜻하는 것은 아니다. Helm과 Kubernetes에서 각각 상태를 확인한다.

```bash
helm list --namespace demo
helm status web --namespace demo
kubectl get pods,svc --namespace demo
```

실습을 끝내고 리소스를 지우려면 Release 이름을 사용한다.

```bash
helm uninstall web --namespace demo
```

---

## 4. `values`로 기본 설정을 바꾼다

Chart에는 작성자가 정한 기본값이 들어 있다. values는 이 기본값 중 일부를 내 환경에 맞게 덮어쓰는 방법이다.

한두 개의 값을 잠깐 바꿀 때는 `--set`을 쓸 수 있다. 다음은 Nginx Pod 개수를 2개로 설정하는 예시다.

```bash
helm upgrade --install web bitnami/nginx \
  --namespace demo \
  --create-namespace \
  --set replicaCount=2 \
  --wait
```

`upgrade --install`은 이름 그대로, 아직 Release가 없으면 설치하고 이미 있으면 업데이트한다. 처음 설치했을 때와 이후 설정을 바꿀 때 같은 명령을 쓸 수 있어 배포 스크립트에서 자주 사용한다.

실제 환경 설정은 명령어보다 파일로 관리하는 편이 낫다. 예를 들어 `nginx-values.yaml`을 만든다.

```yaml
replicaCount: 2

service:
  type: ClusterIP

resources:
  requests:
    cpu: 100m
    memory: 128Mi
```

그리고 `-f` 옵션으로 전달한다.

```bash
helm upgrade --install web bitnami/nginx \
  --namespace demo \
  --create-namespace \
  -f nginx-values.yaml \
  --wait
```

파일로 두면 “기본값에서 무엇을 바꿨는지”를 Git에서 쉽게 비교할 수 있다. 다만 비밀번호를 `--set`이나 일반 values 파일에 넣으면 셸 기록이나 Git에 남을 수 있다. 비밀값은 Chart가 지원하는 기존 Secret 참조 방식이나 별도의 Secret 관리 도구로 전달한다.

---

## 5. 적용 전 결과를 보고, 문제면 되돌린다

Helm이 만들 YAML을 실제 적용 전에 화면으로 확인할 수 있다.

```bash
helm template web bitnami/nginx \
  --namespace demo \
  -f nginx-values.yaml
```

이 명령은 YAML만 출력하며 클러스터를 바꾸지 않는다. 설정이 맞는지 확인한 다음 배포하고, 설치 과정에서 실패하면 원인을 살핀다.

```bash
helm status web --namespace demo
kubectl get pods --namespace demo
kubectl describe pod <Pod-이름> --namespace demo
```

업데이트 이력은 Helm이 Release별로 보관한다.

```bash
helm history web --namespace demo
helm rollback web 1 --namespace demo
```

`rollback`의 마지막 숫자는 되돌아갈 Revision 번호다. 처음에는 `helm history` 출력에서 번호를 확인한 뒤 사용한다. 배포가 실패했을 때 자동으로 이전 상태로 되돌리고 싶다면 `upgrade --install`에 `--atomic`도 추가할 수 있다.

---

## 6. MariaDB Chart에서는 데이터가 저장될 위치를 확인한다

Nginx 같은 무상태 애플리케이션은 Pod가 다시 만들어져도 큰 문제가 없는 경우가 많다. 반면 MariaDB는 데이터 파일을 보관해야 하므로, 설치 전에 스토리지를 먼저 확인해야 한다.

```bash
kubectl get storageclass
kubectl get pvc --all-namespaces
helm show values bitnami/mariadb
```

많은 Chart는 기본적으로 PVC를 만들어 데이터 저장 공간을 요청한다. 클러스터에 동적 프로비저닝을 지원하는 StorageClass가 있으면 PVC가 자동으로 연결될 수 있다. 그렇지 않으면 Pod가 `Pending` 상태에 머무를 수 있는데, 이때는 Helm 명령보다 PVC 이벤트와 StorageClass 설정을 먼저 확인한다.

기존 PVC와 Secret을 준비한 환경에서는 Chart가 지원하는 values로 이를 참조할 수 있다. 다음은 **설치하려는 Chart의 `helm show values`에서 동일한 키를 확인한 뒤에만** 사용할 수 있는 예시다.

```yaml
# mariadb-values.yaml
auth:
  database: appdb
  username: appuser
  existingSecret: mariadb-auth

primary:
  persistence:
    enabled: true
    existingClaim: mariadb-pvc

architecture: standalone
```

처음 MariaDB Chart를 다룰 때는 데이터베이스 설정 자체보다 다음 세 가지를 확인하는 것이 좋다.

1. PVC가 `Bound` 상태인가?
2. Chart가 요구하는 Secret 이름과 키가 준비되었는가?
3. Release를 지운 뒤에도 데이터를 남길 것인가?

---

## 7. 직접 Chart를 만드는 일은 다음 단계다

공개 Chart를 설치하는 데 익숙해진 뒤에는 자체 애플리케이션을 Chart로 만들 수 있다.

```bash
helm create my-app
```

이 명령은 아래와 같은 뼈대를 만든다.

```text
my-app/
├── Chart.yaml       # Chart의 이름과 버전
├── values.yaml      # 사용자가 바꿀 기본값
└── templates/       # Deployment, Service 등을 만드는 템플릿
```

---

## 8. 정리

Helm은 여러 Kubernetes YAML을 Chart로 묶어 설치하고, 그 결과를 Release라는 이름으로 관리한다. 처음에는 Repository를 등록하고, `helm show values`로 설정을 확인한 뒤, `helm install`과 `helm status`를 실행하는 흐름만 익히면 된다.

설정을 바꿀 때는 `--set`보다 values 파일을 우선하고, 적용 전에는 `helm template`으로 생성될 YAML을 확인한다. 데이터베이스처럼 상태를 가진 Chart는 PVC와 Secret, 삭제 뒤 데이터 보존 여부까지 함께 점검해야 한다.
