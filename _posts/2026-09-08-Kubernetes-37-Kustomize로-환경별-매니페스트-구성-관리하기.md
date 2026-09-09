---
layout: post
title: "Kubernetes (37) - Kustomize로 환경별 매니페스트 구성 관리하기"
date: 2026-09-08 12:37:00 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "kustomize", "manifest", "configuration", "overlay", "쿠버네티스"]
---

같은 애플리케이션을 개발 환경과 운영 환경에 배포하면 YAML 파일이 조금씩 달라진다. 개발 환경은 Pod를 1개만 실행하고, 운영 환경은 3개를 실행할 수 있다. Ingress 주소, 이미지 태그, 리소스 제한도 환경마다 다를 수 있다.

이 차이 때문에 YAML을 통째로 복사하면, 시간이 지날수록 어느 파일이 기준인지 알기 어려워진다. Kustomize는 **공통 YAML은 한 번만 작성하고, 환경별로 달라지는 부분만 따로 적는** 도구다. 이 글에서는 가장 작은 예제부터 차례로 사용해 본다.

---


## 1. 먼저 `base`와 `overlay`의 역할을 이해하자

Kustomize는 일반 Kubernetes YAML을 그대로 사용한다. 새 문법으로 Deployment를 작성하는 것이 아니라, `kustomization.yaml`이라는 목록 파일로 YAML을 모으고 필요한 변경을 덧붙인다.

처음에는 다음처럼 생각하면 된다.

```text
base       : 어느 환경에서도 같은 기본 설계도
overlay    : 특정 환경에 붙이는 변경 메모

base + dev overlay  ──→  개발 환경에 적용할 최종 YAML
base + prod overlay ──→  운영 환경에 적용할 최종 YAML
```

| 용어 | 처음 이해할 때의 의미 |
| --- | --- |
| 매니페스트(Manifest) | Deployment, Service처럼 Kubernetes에 전달하는 YAML 파일 |
| `base` | 모든 환경이 함께 쓰는 원본 매니페스트 디렉터리 |
| `overlay` | dev, prod 등 한 환경에만 필요한 변경을 담은 디렉터리 |
| `kustomization.yaml` | 어떤 파일을 합치고 어떤 변경을 적용할지 적는 설정 파일 |
| build | Kustomize가 base와 overlay를 합쳐 최종 YAML을 출력하는 작업 |

`kubectl`에는 Kustomize 기능이 들어 있으므로, 기본 사용에는 별도 설치가 필요 없다. 이 글의 명령은 Kubernetes 클러스터에 접속할 수 있고 `kubectl get nodes`가 동작하는 상태를 가정한다.

---

## 2. 일반 YAML 파일을 하나의 배포 단위로 묶는다

예제로 `echo` 애플리케이션을 만든다. 디렉터리 구조는 다음과 같다.

```text
echo/
├── base/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── kustomization.yaml
└── overlays/
    └── dev/
        └── kustomization.yaml
```

`base/deployment.yaml`은 평소처럼 작성한 Deployment다. Kustomize를 쓴다고 Deployment 내용이 특별해지는 것은 아니다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: echo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: echo
  template:
    metadata:
      labels:
        app: echo
    spec:
      containers:
        - name: echo
          image: ghcr.io/jpubdocker/echo:v0.1.0
          ports:
            - containerPort: 8080
```

여기서 `selector.matchLabels`와 `template.metadata.labels`의 `app: echo`는 반드시 맞아야 한다. Deployment가 자신이 관리할 Pod를 찾는 기준이기 때문이다. `service.yaml`도 같은 레이블을 selector로 사용한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: echo
spec:
  selector:
    app: echo
  ports:
    - port: 80
      targetPort: 8080
```

이제 두 파일을 Kustomize에 등록한다.

```yaml
# base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
```

`resources`는 “이 디렉터리의 배포에는 이 YAML들을 포함한다”는 뜻이다. Ingress, ConfigMap 등이 더 필요해지면 같은 목록에 파일을 추가하면 된다.

---

## 3. 적용하기 전에 최종 YAML을 확인한다

Kustomize의 가장 중요한 습관은 **바로 배포하지 말고 build 결과부터 보는 것**이다.

```bash
cd echo
kubectl kustomize base
```

위 명령은 `deployment.yaml`과 `service.yaml`을 합쳐 화면에 출력한다. 아직 클러스터에는 아무 변화가 없다. 출력에서 리소스 이름, 이미지, `replicas` 값을 확인한 뒤 적용한다.

```bash
kubectl apply -k base
kubectl get deploy,svc
```

`-k`는 파일 하나(`-f`)가 아니라 Kustomize 디렉터리를 입력으로 받는다는 뜻이다. 별도 Kustomize 명령을 사용한다면 다음도 같은 결과다.

```bash
kustomize build base | kubectl apply -f -
```

두 명령을 한 번에 쓸 필요는 없다. 처음에는 `kubectl apply -k base`만 기억해도 충분하다. 삭제할 때도 같은 디렉터리를 지정한다.

```bash
kubectl delete -k base
```

---

## 4. 개발 환경의 차이는 overlay에만 적는다

이제 개발 환경에서는 Pod를 2개 실행한다고 가정한다. `base`의 `replicas: 1`을 고치거나 Deployment 파일을 복사하지 않는다. 대신 `overlays/dev/kustomization.yaml`에서 base를 참조한다.

```yaml
# overlays/dev/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
patches:
  - path: patch-deployment.yaml
```

`../../base`는 현재 `overlays/dev` 디렉터리에서 base로 이동하는 상대 경로다. 이어서 같은 디렉터리에 `patch-deployment.yaml`을 만든다.

```yaml
# overlays/dev/patch-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: echo
spec:
  replicas: 2
```

패치 파일에는 **바꾸려는 부분만** 적는다. Kustomize는 `kind: Deployment`, `metadata.name: echo`를 기준으로 base의 Deployment를 찾아 `replicas` 값만 2로 바꾼다.

```bash
kubectl kustomize overlays/dev
kubectl diff -k overlays/dev
kubectl apply -k overlays/dev
```

명령의 흐름은 다음과 같다.

```text
1. base의 Deployment에는 replicas: 1이 있다.
2. dev 패치에는 replicas: 2가 있다.
3. Kustomize가 둘을 합쳐 dev용 Deployment를 만든다.
4. 클러스터에는 replicas: 2인 결과만 적용된다.
```

운영 환경이 필요해지면 `overlays/prod`를 만들고 `replicas: 3` 같은 운영 전용 변경만 추가하면 된다. 공통 컨테이너 이미지나 Service 설정을 수정할 때는 `base`를 한 번만 바꾸면 된다.

---

## 5. 반복되는 메타데이터와 Secret을 관리한다

여러 리소스에 같은 관리용 레이블을 붙이고 싶다면 `kustomization.yaml`에 `labels`를 추가한다.

```yaml
# base/kustomization.yaml 일부
labels:
  - pairs:
      app.kubernetes.io/part-of: echo-demo
      app.kubernetes.io/managed-by: kustomize
```

이 레이블은 사람이 `kubectl get ... -l`로 리소스를 찾거나 운영 도구에서 분류하는 데 쓸 수 있다. 반면 앞에서 사용한 `app: echo`는 Service와 Pod를 연결하는 식별자이므로, 초보 단계에서는 Deployment와 Service YAML에 명시적으로 유지하는 편이 이해하기 쉽다.

비밀번호처럼 코드에 넣으면 안 되는 값은 `secretGenerator`로 Secret 리소스를 만들 수 있다.

```yaml
# overlays/dev/kustomization.yaml 일부
secretGenerator:
  - name: echo-db
    envs:
      - .env.secret
```

```text
# overlays/dev/.env.secret
DB_USERNAME=appuser
DB_PASSWORD=change-me
```

`.env.secret`에는 실제 비밀값이 들어 있으므로 `.gitignore`에 추가하고 Git에 커밋하지 않는다. Secret YAML의 값은 보통 base64로 표현되지만, 이는 암호화가 아니라 인코딩일 뿐이라는 점도 기억해야 한다.

---

## 6. 정리

Kustomize는 YAML을 복사해 환경별 파일을 만드는 대신, 공통 부분은 `base`에 두고 달라지는 부분만 `overlay`에 적게 해 준다. 처음에는 `resources`로 YAML을 묶고 `kubectl apply -k`로 적용하는 것부터 시작하면 된다.

환경별 설정이 생기면 overlay와 작은 패치 파일을 추가한다. 적용 전에는 `kubectl kustomize` 또는 `kubectl diff -k`로 결과를 확인하면, 의도하지 않은 변경이 클러스터에 반영되는 일을 줄일 수 있다.
