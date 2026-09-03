---
layout: post
title: "Kubernetes (24) - Secret으로 기밀 정보를 안전하게 주입하기"
date: 2026-09-02 08:14:41 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "secret", "security", "credentials", "environment-variable", "volume", "쿠버네티스"]
---

데이터베이스 비밀번호, API 토큰, TLS 개인 키처럼 이미지나 일반 설정 파일에 넣으면 안 되는 값이 있다. Kubernetes의 Secret은 이런 기밀 데이터를 별도 리소스로 관리하고, 필요한 Pod에만 환경 변수 또는 파일로 전달하는 기능이다.

Secret을 사용한다고 해서 기밀 정보 관리가 자동으로 완성되는 것은 아니다. 누가 Secret을 읽을 수 있는지 RBAC로 제한하고, Git 저장소에 실제 값을 남기지 않으며, 변경된 값을 애플리케이션에 반영하는 방식까지 함께 설계해야 한다.

---

## 1. Secret은 기밀 정보를 Pod와 분리한다

애플리케이션 이미지에 비밀번호를 포함하면 이미지가 배포되는 모든 레지스트리와 환경에 기밀 정보가 따라간다. 값을 바꾸려면 이미지를 다시 빌드해야 하고, 이미 내려받은 이미지에도 이전 값이 남을 수 있다.

Pod나 Deployment 매니페스트에 값을 직접 작성하는 방식도 관리하기 어렵다. 여러 워크로드가 같은 인증 정보를 사용하면 같은 값을 반복하게 되며, 매니페스트를 Git으로 관리할 때 기밀 정보가 함께 노출될 위험이 있다.

Secret은 기밀 데이터를 독립된 Kubernetes 리소스로 두고, Pod가 필요한 키만 참조하도록 만든다.

```text
Secret (username, password)
        │
        ├─ 환경 변수 → 컨테이너 프로세스
        └─ 볼륨 파일 → 컨테이너 파일 시스템
```

다만 Secret의 `data` 값은 Base64로 **인코딩**되어 저장될 뿐, Base64 자체가 암호화는 아니다. 권한이 있는 사용자는 값을 쉽게 디코드할 수 있다. 따라서 실제 값이 든 Secret 매니페스트를 그대로 Git에 커밋하지 말고, 접근 제어와 저장 데이터 암호화, 필요한 경우 외부 시크릿 관리 도구를 함께 검토해야 한다.

---

## 2. Secret 타입과 생성 방법

가장 흔히 쓰는 타입은 범용 키-값 데이터를 담는 `Opaque`다. `type`을 생략하면 `Opaque`로 처리된다. Kubernetes는 TLS 인증서, 프라이빗 이미지 레지스트리 인증 정보처럼 정해진 형식이 필요한 용도를 위한 타입도 제공한다.

| 타입 | 용도 |
| --- | --- |
| `Opaque` | 사용자 이름·비밀번호·API 키 등 일반적인 키-값 데이터 |
| `kubernetes.io/tls` | TLS 인증서와 개인 키 |
| `kubernetes.io/basic-auth` | 기본 인증 사용자 이름과 비밀번호 |
| `kubernetes.io/dockerconfigjson` | 프라이빗 컨테이너 레지스트리 인증 정보 |
| `kubernetes.io/ssh-auth` | SSH 인증 정보 |
| `kubernetes.io/service-account-token` | 레거시 ServiceAccount 토큰 저장 방식 |
| `bootstrap.kubernetes.io/token` | 클러스터 부트스트랩 토큰 |

범용 Secret은 파일, env 파일, 리터럴 값, 매니페스트로 만들 수 있다. 실습에서 파일로 만들 때는 `echo`가 붙이는 줄바꿈이 Secret 값에 들어가지 않도록 `-n` 옵션을 사용한다.

```bash
echo -n "app-user" > ./username
echo -n "change-me" > ./password

kubectl create secret generic sample-db-auth \
  --from-file=./username \
  --from-file=./password
```

여러 키-값을 한 파일에서 만들고 싶다면 `--from-env-file`을 사용할 수 있다.

```text
# db-secret.env
username=app-user
password=change-me
```

```bash
kubectl create secret generic sample-db-auth \
  --from-env-file=./db-secret.env
```

매니페스트의 `data`에는 Base64로 인코딩한 문자열을 넣어야 한다. 사람이 직접 작성하는 예제라면 일반 문자열을 받는 `stringData`가 더 읽기 쉽다. API 서버는 `stringData` 값을 내부적으로 `data`에 병합한다.

```yaml
# sample-db-auth.yaml
apiVersion: v1
kind: Secret
metadata:
  name: sample-db-auth
type: Opaque
stringData:
  username: app-user
  password: change-me
```

아래 명령으로 키의 존재를 확인하거나, 실습 환경에서만 값을 디코드해 확인할 수 있다. 운영 환경의 터미널 출력·로그에는 실제 기밀 값을 남기지 않도록 주의한다.

```bash
kubectl get secret sample-db-auth
kubectl get secret sample-db-auth -o jsonpath='{.data.username}' | base64 --decode
```

---

## 3. Pod가 Secret을 참조해 사용하는 흐름

Secret만 생성했다고 해서 모든 Pod에 값이 자동으로 전달되지는 않는다. 사용할 Pod의 매니페스트에서 Secret 이름과 키를 명시적으로 참조해야 한다. Secret과 Pod는 같은 Namespace에 있어야 한다.

아래 예제에서는 `sample-secret-app` Pod가 `sample-db-auth` Secret의 `username`, `password` 키를 각각 `DB_USERNAME`, `DB_PASSWORD` 환경 변수로 받아 사용한다. 실제 애플리케이션에서는 이 값을 데이터베이스 클라이언트 설정에 전달한다. 여기서는 동작을 확인하기 위해 사용자 이름과 비밀번호의 설정 여부만 로그에 출력하며, 비밀번호 값 자체는 출력하지 않는다.

```text
sample-db-auth Secret
  ├─ username ── secretKeyRef ──→ DB_USERNAME ──→ sample-secret-app 컨테이너
  └─ password ── secretKeyRef ──→ DB_PASSWORD ──→ sample-secret-app 컨테이너
```

```yaml
# sample-secret-app.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-secret-app
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - /bin/sh
        - -c
        - |
          echo "database user: $DB_USERNAME"
          if [ -n "$DB_PASSWORD" ]; then
            echo "database password is configured"
          fi
          sleep 3600
      env:
        - name: DB_USERNAME
          valueFrom:
            secretKeyRef:
              name: sample-db-auth
              key: username
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: sample-db-auth
              key: password
```

```bash
kubectl apply -f sample-db-auth.yaml
kubectl apply -f sample-secret-app.yaml
kubectl logs sample-secret-app
```

출력은 다음과 비슷하다.

```text
database user: app-user
database password is configured
```

Secret의 모든 키를 환경 변수로 전달할 때는 `envFrom.secretRef`를 사용한다. 이 경우 Secret 키 이름이 환경 변수 이름이 된다. `sample-db-auth`의 키가 `username`, `password`이므로 컨테이너에서는 `$username`, `$password`로 사용한다.

```yaml
# sample-secret-all-env.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-secret-all-env
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - /bin/sh
        - -c
        - |
          echo "database user: $username"
          if [ -n "$password" ]; then
            echo "database password is configured"
          fi
          sleep 3600
      envFrom:
        - secretRef:
            name: sample-db-auth
```

```bash
kubectl apply -f sample-secret-all-env.yaml
kubectl logs sample-secret-all-env
```

`envFrom`은 특정 키를 `DB_USERNAME`처럼 다른 이름으로 바꾸어 가져올 수 없다. `DB_USERNAME`, `DB_PASSWORD`라는 이름을 유지하고 싶다면 Secret을 만들 때부터 키 이름을 그에 맞게 정한다.

```yaml
stringData:
  DB_USERNAME: app-user
  DB_PASSWORD: change-me
```

`envFrom`으로 가져올 때 환경 변수 이름으로 사용할 수 없는 Secret 키는 건너뛰며, Pod는 시작되지만 경고 이벤트가 기록된다. 여러 값을 편하게 주입할 때는 `envFrom`이 유용하지만, 꼭 필요한 키만 선택하거나 환경 변수 이름을 바꿔야 할 때는 앞의 `secretKeyRef` 방식을 사용한다.

환경 변수는 간단하지만, 컨테이너 안에서 실행한 명령이나 오류 출력, 디버깅 도구를 통해 의도치 않게 노출될 수 있다. 또한 Secret을 수정해도 이미 실행 중인 컨테이너의 환경 변수는 바뀌지 않으므로, 변경을 반영하려면 Pod를 다시 만들어야 한다.

---

## 4. Secret을 볼륨으로 마운트하기

인증서·키 파일처럼 애플리케이션이 파일 경로를 기대하거나, Secret 변경을 파일 갱신으로 받아들여야 한다면 볼륨 마운트 방식이 적합하다. Secret의 각 키는 마운트 경로 아래의 파일 하나가 된다.

아래 예제에서 `sample-secret-volume` Pod는 `sample-db-auth` Secret을 `/etc/app/credentials`에 마운트한다. 컨테이너의 명령은 `username` 파일을 읽고, `password` 파일이 준비됐는지만 확인한다. 실제 애플리케이션이라면 데이터베이스 클라이언트나 TLS 라이브러리가 이 파일 경로를 설정값으로 받아 사용한다.

```text
sample-db-auth Secret
  ├─ username ──→ /etc/app/credentials/username ──→ 컨테이너가 파일 읽기
  └─ password ──→ /etc/app/credentials/password ──→ 컨테이너가 파일 읽기
```

```yaml
# sample-secret-volume.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-secret-volume
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - /bin/sh
        - -c
        - |
          echo "database user: $(cat /etc/app/credentials/username)"
          if [ -s /etc/app/credentials/password ]; then
            echo "database password file is configured"
          fi
          sleep 3600
      volumeMounts:
        - name: db-auth
          mountPath: /etc/app/credentials
          readOnly: true
  volumes:
    - name: db-auth
      secret:
        secretName: sample-db-auth
```

이 예제에서는 `/etc/app/credentials/username`, `/etc/app/credentials/password` 파일이 생성된다. `readOnly: true`를 지정했으므로 컨테이너는 이 마운트 경로의 Secret 파일을 수정할 수 없다.

```bash
kubectl apply -f sample-db-auth.yaml
kubectl apply -f sample-secret-volume.yaml
kubectl logs sample-secret-volume
```

출력은 다음과 비슷하다.

```text
database user: app-user
database password file is configured
```

애플리케이션이 시작 뒤에 파일을 읽는 방식도 확인할 수 있다. 운영 환경에서 비밀번호 파일의 내용을 `cat`으로 출력하면 로그에 기밀 정보가 남으므로 피해야 한다.

```bash
kubectl exec sample-secret-volume -- ls /etc/app/credentials
kubectl exec sample-secret-volume -- cat /etc/app/credentials/username
```

Secret을 일반 볼륨으로 마운트하면 kubelet은 변경된 Secret을 감지해 Pod 안의 파일을 최종적으로 갱신한다. 다만 애플리케이션 프로세스가 파일 변경을 자동으로 다시 읽는지는 별개의 문제다. 갱신 감지 기능이 없다면 재시작 또는 애플리케이션별 reload 절차가 필요하다.

`subPath`로 Secret 파일 하나만 마운트하면 자동 갱신을 받지 못한다. 갱신이 필요하다면 Secret 볼륨 전체를 마운트하고, 애플리케이션이 파일 변경을 처리할 수 있는지 확인한다.

---

## 5. TLS와 프라이빗 레지스트리 Secret

### TLS 인증서 타입 Secret

TLS(Transport Layer Security)는 HTTPS 통신을 위한 보안 프로토콜이다. Kubernetes에서는 TLS 인증서와 개인 키를 `kubernetes.io/tls` 타입 Secret으로 만들고, 주로 Ingress의 HTTPS 설정에 연결한다.

예를 들어 `example.com`에 TLS를 적용하려면 인증서 파일(`tls.crt`)과 개인 키 파일(`tls.key`)을 준비한 뒤 Secret을 만든다.

```bash
kubectl create secret tls example-tls \
  --cert=tls.crt \
  --key=tls.key
```

그다음 Ingress의 `spec.tls`에서 Secret 이름을 참조한다.

```yaml
spec:
  tls:
    - hosts:
        - example.com
      secretName: example-tls
```

`secretName`에 지정한 Secret은 Ingress와 같은 Namespace에 있어야 한다.

### 프라이빗 레지스트리 Secret

프라이빗 레지스트리의 이미지를 가져오려면 레지스트리 로그인 정보를 `kubernetes.io/dockerconfigjson` 타입 Secret으로 만든다.

```bash
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=registry-user \
  --docker-password='<registry-access-token>'
```

Pod 템플릿의 `imagePullSecrets`에서 이 Secret을 참조하면 kubelet이 이미지를 내려받을 때 레지스트리에 인증한다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: private-image-app
spec:
  containers:
    - name: app
      image: registry.example.com/team/app:1.0
  imagePullSecrets:
    - name: regcred
```

`imagePullSecrets`는 컨테이너에 인증 정보를 환경 변수나 파일로 전달하지 않는다. 이미지를 받기 전에 kubelet이 사용하는 인증 정보이며, Secret은 Pod와 같은 Namespace에 있어야 한다.

---

## 6. 운영 시 확인할 점

Secret은 기밀 정보의 노출 범위를 줄이는 도구이지, 모든 보안 문제를 해결하는 것은 아니다. 다음 항목을 함께 점검한다.

| 확인 항목 | 이유 |
| --- | --- |
| RBAC 최소 권한 | `get`, `list`, `watch` 권한이 있는 주체는 Namespace의 Secret 데이터를 읽을 수 있으므로 필요한 범위만 부여 |
| Git 저장소 관리 | Base64 값도 원문으로 복원할 수 있으므로 실제 Secret 매니페스트·env 파일을 커밋하지 않음 |
| 저장 데이터 암호화 | 클러스터에서 Secret의 etcd 저장 데이터 암호화를 구성하고 키 관리 정책을 마련 |
| 전달 방식 선택 | 시작 시 한 번 읽으면 환경 변수, 파일 기반 설정·인증서는 볼륨 마운트를 우선 검토 |
| 교체 절차 | 환경 변수는 Pod 재시작이 필요하고, 볼륨도 애플리케이션의 reload 방식까지 확인 |

또한 Secret은 Namespace 범위의 리소스이므로 Pod와 같은 Namespace에 있어야 한다. 하나의 Secret을 여러 Namespace에서 직접 공유할 수는 없으며, 필요한 경우 각 Namespace에 별도로 배포하고 권한을 분리한다.

---

## 7. 정리

Secret은 비밀번호, 토큰, 인증서처럼 민감한 값을 이미지와 일반 Pod 설정에서 분리하고, 필요한 컨테이너에만 전달하게 해 준다. 범용 `Opaque` Secret은 `stringData` 또는 `data`로 만들고, 애플리케이션 요구에 따라 특정 키를 환경 변수로 주입하거나 파일로 마운트할 수 있다.

다만 Base64는 암호화가 아니며, 환경 변수는 실행 중에 자동 갱신되지 않는다. Secret을 안전하게 운영하려면 RBAC 최소 권한, Git 유출 방지, 저장 데이터 암호화, 값 교체와 애플리케이션 reload 절차를 함께 갖춰야 한다.

---

## 참고 자료

* [Kubernetes 문서 - Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
* [Kubernetes 문서 - Distribute Credentials Securely Using Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/)
