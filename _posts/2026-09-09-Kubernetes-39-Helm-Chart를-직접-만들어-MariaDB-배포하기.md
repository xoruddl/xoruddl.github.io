---
layout: post
title: "Kubernetes (39) - Helm Chart를 직접 만들어 MariaDB 배포하기"
date: 2026-09-09 12:39:00 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "helm", "chart", "template", "mariadb", "쿠버네티스"]
---

공개 Chart를 설치하는 데 익숙해지면 다음 질문이 생긴다. "내가 만든 애플리케이션도 이렇게 한 명령으로 설치할 수 있을까?" 답은 Chart를 직접 만드는 것이다.

Chart를 만든다는 말은 대단해 보이지만, 실제로는 **이미 쓰던 YAML에서 환경마다 달라지는 값만 빈칸으로 바꾸는 작업**에 가깝다. 이 글에서는 MariaDB를 설치하는 Chart를 처음부터 만들어 보면서, Chart의 구조와 템플릿 문법을 익힌다.

---


## 1. Chart는 세 부분으로 이루어진다

Chart 디렉터리를 열어 보면 이름은 여러 개지만, 처음 이해해야 할 것은 세 가지이다.

```text
custom-mariadb/
├── Chart.yaml     # 이 Chart가 무엇인지 (이름, 버전)
├── values.yaml    # 빈칸에 채울 기본값
└── templates/     # 빈칸이 뚫린 Kubernetes 매니페스트
```

| 파일 | 역할 | 비유하면 |
| --- | --- | --- |
| `Chart.yaml` | Chart의 이름·버전 같은 메타데이터 | 패키지의 라벨 |
| `values.yaml` | 사용자가 바꿀 수 있는 값의 기본값 | 설정 파일 |
| `templates/` | Deployment, Service, Secret 등 실제 리소스 | 빈칸이 있는 서식 |

Helm이 하는 일은 결국 `templates/`의 빈칸에 `values.yaml`의 값을 채워 넣어 완성된 YAML을 만들고, 그것을 클러스터에 적용하는 것이다.

```text
templates/ (빈칸 있는 YAML) + values.yaml (채울 값)
                    │
                    ▼
        완성된 Kubernetes 매니페스트
                    │
                    ▼
              Release로 설치
```

---

## 2. 뼈대는 직접 만들 수도, 자동 생성할 수도 있다

Helm에는 Chart 뼈대를 만들어 주는 명령이 있다.

```bash
helm create my-app
```

이 명령은 Deployment, Service 같은 기본 템플릿을 한 번에 만든다. 편리하지만 처음에는 파일이 많아 오히려 복잡하게 느껴질 수 있다.

그래서 이 글에서는 빈 디렉터리에서 필요한 파일만 하나씩 만든다.

```bash
mkdir -p custom-mariadb/templates
cd custom-mariadb
```

구조가 눈에 익은 뒤에 `helm create`로 만든 뼈대를 열어 보면, 어떤 파일이 왜 있는지 훨씬 빨리 파악할 수 있다.

---

## 3. `Chart.yaml`에는 Chart의 신분 정보를 적는다

먼저 Chart 자체를 설명하는 파일을 만든다.

```yaml
# Chart.yaml
apiVersion: v2
name: custom-mariadb
description: A custom Helm Chart
type: application
version: 0.1.0
appVersion: "11.4"
```

각 항목의 의미는 다음과 같다.

| 항목 | 의미 |
| --- | --- |
| `apiVersion` | Chart 형식의 버전. Helm 3에서는 `v2` |
| `name` | Chart 이름. 디렉터리 이름과 맞추는 것이 관례 |
| `description` | Chart에 대한 한 줄 설명 |
| `version` | **Chart 자체의 버전** |
| `appVersion` | **Chart가 설치하는 애플리케이션의 버전** |

`version`은 Chart의 버전이고, `appVersion`은 MariaDB 자체의 버전이다. 둘은 다른 값이라는 점만 기억하면 충분하다.

---

## 4. `values.yaml`에 바뀔 수 있는 값을 모은다

템플릿에 값을 직접 적지 않고 이 파일에 모아 두면, 나중에 설치하는 사람은 이 파일만 보고 무엇을 바꿀 수 있는지 알 수 있다.

```yaml
# values.yaml
image:
  repository: mariadb
  tag: "11.4"
  pullPolicy: IfNotPresent

mariadb:
  rootPassword: "SecretRootPassword123!"
  database: "appdb"
  user: "appuser"
  password: "UserPassword123!"

persistence:
  hostPath: "/data/mariadb"
  storageSize: "1Gi"

service:
  type: ClusterIP
  port: 3306
```

값을 계층으로 묶어 두면 템플릿에서 `.Values.image.repository`처럼 읽는다.

여기서 비밀번호가 평문으로 들어가 있는 점은 짚고 넘어가야 한다. 학습용 예제라 그대로 두지만, 실제 환경에서는 `values.yaml`이 Git에 올라가므로 비밀번호를 여기에 두면 안 된다. 미리 만들어 둔 Secret을 참조하도록 하거나, 별도의 비밀 관리 도구로 전달한다.

---

## 5. 템플릿 문법은 네 가지만 알면 시작할 수 있다

`templates/` 안의 파일은 일반 YAML에 `{{ }}` 표기가 섞인 형태다. 처음에는 다음 네 가지면 충분하다.

| 문법 | 의미 |
| --- | --- |
| `{{ .Values.어쩌구 }}` | `values.yaml`에서 값을 가져온다 |
| `{{ .Release.Name }}` | 설치할 때 지정한 Release 이름 |
| `{{ ... \| quote }}` | 값을 따옴표로 감싼다 |
| `{{- if 조건 }} ... {{- end }}` | 조건이 참일 때만 해당 블록을 출력한다 |

`{{-`처럼 붙는 하이픈은 앞쪽 공백과 줄바꿈을 지우라는 뜻이다. 조건문이 빠졌을 때 빈 줄이 남아 YAML이 어색해지는 것을 막아 준다.

`.Release.Name`을 리소스 이름에 붙이는 것은 중요한 습관이다. 같은 Chart를 `db-dev`, `db-prod`로 두 번 설치해도 리소스 이름이 겹치지 않는다.

---

## 6. Secret: 비밀번호를 Pod에 안전하게 전달한다

첫 템플릿으로 Secret을 만든다.

```yaml
# templates/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: {{ .Release.Name }}-secret
type: Opaque
stringData:
  mariadb-root-password: {{ .Values.mariadb.rootPassword | quote }}
  mariadb-password: {{ .Values.mariadb.password | quote }}
```

`stringData`를 쓰면 Base64로 직접 인코딩하지 않아도 Kubernetes가 저장할 때 변환해 준다. 템플릿에서 값을 다룰 때 인코딩까지 신경 쓰지 않아도 되므로 관리가 쉽다.

비밀번호에 `!`나 `#`처럼 YAML에서 의미를 갖는 문자가 들어갈 수 있으므로, `| quote`로 감싸 문자열임을 분명히 한다.

---

## 7. PV와 PVC: 데이터가 남을 자리를 만든다

MariaDB는 Pod가 다시 만들어져도 데이터가 남아야 하므로 볼륨이 필요하다. 학습 환경에서는 노드의 디렉터리를 그대로 쓰는 `hostPath`가 가장 간단하다.

```yaml
# templates/pv.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: {{ .Release.Name }}-pv
  labels:
    app: {{ .Release.Name }}
  annotations:
    "helm.sh/resource-policy": keep
spec:
  capacity:
    storage: {{ .Values.persistence.storageSize }}
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: {{ .Values.persistence.hostPath }}
    type: DirectoryOrCreate
```

`hostPath`는 노드의 디스크를 그대로 사용한다. 따라서 이 예제는 학습용 또는 단일 노드 환경에 적합하다.

이어서 이 PV를 요청하는 PVC를 만든다.

```yaml
# templates/pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ .Release.Name }}-pvc
spec:
  accessModes:
  - ReadWriteOnce
  storageClassName: manual
  resources:
    requests:
      storage: {{ .Values.persistence.storageSize }}
```

PV와 PVC의 `storageClassName`과 `accessModes`가 서로 맞아야 연결(Bound)된다. 설치 후 Pod가 `Pending`에 머문다면 이 두 값과 용량을 먼저 확인한다.

`Retain`은 PVC를 지워도 데이터를 남기는 정책이고, `helm.sh/resource-policy: keep`은 Helm이 PV를 지우지 않게 한다. 그래서 실습을 지운 뒤에도 PV와 데이터는 남을 수 있으며, 필요 없을 때 직접 정리해야 한다.

---

## 8. Deployment와 Service: 실제로 MariaDB를 띄운다

앞에서 만든 Secret과 PVC를 사용하는 Deployment를 작성한다.

이 예제는 Helm 템플릿의 연결 관계에 집중하기 위해 복제본이 하나인 Deployment를 사용한다. 24편에서 살펴본 것처럼 Pod별로 안정적인 이름과 개별 볼륨이 필요한 데이터베이스 클러스터라면 StatefulSet이 더 적합하며, 실제 운영에서는 동적 프로비저닝과 백업·복구 방식까지 함께 설계해야 한다.

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}
  labels:
    app: {{ .Release.Name }}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app: {{ .Release.Name }}
    spec:
      containers:
      - name: mariadb
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
        imagePullPolicy: {{ .Values.image.pullPolicy }}
        ports:
        - containerPort: 3306
        env:
        - name: MARIADB_ROOT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: {{ .Release.Name }}-secret
              key: mariadb-root-password
        - name: MARIADB_DATABASE
          value: {{ .Values.mariadb.database | quote }}
        - name: MARIADB_USER
          value: {{ .Values.mariadb.user | quote }}
        - name: MARIADB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: {{ .Release.Name }}-secret
              key: mariadb-password
        volumeMounts:
        - name: data
          mountPath: /var/lib/mysql
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: {{ .Release.Name }}-pvc
```

비밀번호는 `value`로 직접 넣지 않고 `secretKeyRef`로 Secret에서 읽는다. 이렇게 하면 `kubectl describe pod`를 실행해도 비밀번호가 그대로 보이지 않는다.

접속 주소를 고정하려면 Service가 필요하다.

```yaml
# templates/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ .Release.Name }}-svc
spec:
  type: {{ .Values.service.type }}
  selector:
    app: {{ .Release.Name }}
  ports:
  - port: {{ .Values.service.port }}
    targetPort: 3306
```

`selector`의 라벨이 Deployment의 Pod 라벨과 같아야 트래픽이 전달된다. 두 곳 모두 `{{ .Release.Name }}`을 쓰면 값이 어긋날 일이 없다.

여기까지가 MariaDB를 띄우는 최소 구성이다.

---

## 9. 설치 전에 렌더링 결과를 확인한다

Chart를 다 만들었으면 바로 설치하지 말고, 문법 검사와 렌더링 결과 확인을 먼저 한다. 이 글처럼 `custom-mariadb` 디렉터리 안에서 작업 중이라면 `.`은 현재 Chart 디렉터리를 뜻한다.

```bash
helm lint .
helm template mydb . --namespace demo
```

`helm lint`는 Chart 구조와 문법 문제를 찾아 준다. `helm template`은 값이 채워진 최종 YAML을 화면에 출력하며 클러스터를 변경하지 않는다. 출력에서 `{{ }}`가 남아 있거나 값이 비어 있으면 템플릿이나 `values.yaml`을 다시 확인한다.

결과가 의도한 대로 보이면 설치한다.

```bash
helm install mydb . \
  --namespace demo \
  --create-namespace \
  --wait
```

설치 후 상태를 확인하는 흐름은 공개 Chart를 쓸 때와 같다.

```bash
helm list --namespace demo
kubectl get pods,svc,pvc --namespace demo
```

값을 바꿔 다시 적용할 때는 `values.yaml`을 수정하거나 `--set`으로 덮어쓴다.

```bash
helm upgrade --install mydb . \
  --namespace demo \
  --set service.type=NodePort \
  --wait
```

업데이트 이력과 되돌릴 Revision 번호는 다음 명령으로 확인한다. 문제가 생겼다면 원하는 Revision으로 되돌릴 수 있다.

```bash
helm history mydb --namespace demo
helm rollback mydb 1 --namespace demo
```

실습을 마쳤으면 Release 이름으로 정리한다. 이 예제의 PV와 데이터는 남을 수 있으므로, 필요할 때만 별도로 삭제한다.

```bash
helm uninstall mydb --namespace demo
kubectl get pv
```

---

## 10. 정리

Chart는 `Chart.yaml`, `values.yaml`, `templates/` 세 부분으로 이루어진다. 템플릿에 빈칸을 만들고 `values.yaml`에 기본값을 모아 두면, Helm이 완성된 Kubernetes YAML을 만들어 설치한다.

처음에는 `.Values`, `.Release.Name`, `| quote`, `{{- if }}`만 익혀도 충분하다. 만든 뒤에는 `helm lint`와 `helm template`으로 결과를 확인하고 설치하는 습관을 들이자.
