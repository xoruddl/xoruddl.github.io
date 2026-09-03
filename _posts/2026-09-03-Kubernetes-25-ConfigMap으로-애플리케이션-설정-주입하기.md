---
layout: post
title: "Kubernetes (25) - ConfigMap으로 애플리케이션 설정 주입하기"
date: 2026-09-03 09:13:18 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "configmap", "configuration", "environment-variable", "volume", "nginx", "쿠버네티스"]
---

애플리케이션은 개발·테스트·운영 환경마다 서로 다른 설정값을 사용한다. 예를 들어 실행 모드, 서버 주소, 로그 수준, 기능을 켜고 끄는 값이 여기에 해당한다. 이런 일반 설정값은 컨테이너 이미지와 분리해 관리하는 편이 좋다.

Kubernetes의 ConfigMap은 일반 설정 데이터를 저장해 Pod에 전달하는 리소스다. `APP_MODE=production`처럼 설정 항목 하나를 저장할 수도 있고, Nginx 설정 파일처럼 파일 전체를 저장할 수도 있다. 다만 ConfigMap은 기밀 정보를 위한 저장소가 아니므로 비밀번호·토큰·인증서 개인 키는 Secret으로 관리해야 한다.

---

## 1. ConfigMap은 일반 설정을 Pod와 분리한다

컨테이너 이미지는 어디서 실행하더라도 같은 내용으로 재사용하는 것이 이상적이다. 이미지 안에 운영 서버 주소나 설정 파일을 넣어두면, 설정이 바뀔 때마다 이미지를 다시 빌드해야 한다. Pod 매니페스트에 같은 값을 반복해서 작성하면 여러 애플리케이션의 설정을 한꺼번에 바꾸기도 어렵다.

ConfigMap은 이 문제를 해결하기 위해 일반 설정을 Pod와 별도의 Kubernetes 리소스로 저장한다. 여기서 **키(key)** 는 설정의 이름이고, **값(value)** 은 그 이름에 연결된 실제 설정값이다. Pod는 필요한 키를 골라 환경 변수 또는 파일로 받아 사용한다.

```text
ConfigMap (APP_MODE, LOG_LEVEL, nginx.conf)
        │
        ├─ 환경 변수 → 컨테이너 프로세스
        └─ 볼륨 파일 → 컨테이너 파일 시스템
```

ConfigMap 하나의 `data`와 `binaryData`를 합친 크기는 최대 1 MiB다. 즉, 큰 파일을 보관하는 저장소가 아니라 애플리케이션 실행에 필요한 비교적 작은 설정을 전달하는 도구라고 이해하면 된다.

ConfigMap은 Namespace 범위의 리소스다. 따라서 이를 참조하는 Pod는 같은 Namespace에 있어야 하며, 다른 Namespace의 ConfigMap을 직접 참조할 수 없다.

---

## 2. `kubectl create`로 ConfigMap 만들기

실습은 다음 순서로 진행한다. 먼저 ConfigMap을 만들고, 저장된 내용을 확인한 뒤, 마지막으로 Pod에서 설정을 사용한다.

`kubectl create configmap` 명령은 파일이나 직접 입력한 문자열에서 ConfigMap을 만든다. 파일을 사용할 때는 `--from-file`, 단일 키-값을 직접 지정할 때는 `--from-literal` 옵션을 사용한다.

### 설정 파일에서 만들기

먼저 Nginx의 기본 설정 일부를 담은 `nginx.conf` 파일을 만든다.

```text
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;
```

다음 명령은 방금 만든 파일의 내용을 `sample-configmap`이라는 이름의 ConfigMap으로 저장한다. `--save-config`는 나중에 `kubectl apply`를 사용할 때 필요한 마지막 적용 구성을 어노테이션에 기록한다. 처음 실습할 때는 이 옵션의 동작을 모두 이해하지 않아도 되며, 지금은 파일을 ConfigMap으로 옮긴다고 생각하면 된다.

```bash
kubectl create configmap --save-config sample-configmap \
  --from-file=./nginx.conf
```

`--from-file=./nginx.conf`처럼 키를 생략하면 파일 이름인 `nginx.conf`가 자동으로 키가 된다. 따라서 ConfigMap 안에는 `nginx.conf`라는 이름과 파일 전체 내용이 한 쌍으로 저장된다.

파일 이름과 다른 키를 사용하려면 `키=경로` 형식으로 지정한다.

```bash
kubectl create configmap sample-nginx-config \
  --from-file=default.conf=./nginx.conf
```

이 경우 `sample-nginx-config`의 키는 `default.conf`다. 디렉터리를 지정하면 디렉터리 안의 일반 파일을 각각 하나의 키로 추가할 수도 있다.

### 리터럴 값에서 만들기

파일이 아니라 간단한 설정값만 필요하다면 `--from-literal`을 사용한다. 옵션을 여러 번 지정하면 여러 키-값을 하나의 ConfigMap에 넣을 수 있다. 아래 명령은 `APP_MODE`와 `LOG_LEVEL`이라는 두 설정을 만든다.

```bash
kubectl create configmap sample-app-config \
  --from-literal=APP_MODE=production \
  --from-literal=LOG_LEVEL=info
```

환경 파일의 `KEY=VALUE` 형식을 이미 사용하고 있다면 `--from-env-file`도 편리하다.

```text
# app.env
APP_MODE=production
LOG_LEVEL=info
```

```bash
kubectl create configmap sample-app-config \
  --from-env-file=./app.env
```

---

## 3. 저장된 데이터 확인하기

ConfigMap을 만들었다면 먼저 이름이 목록에 보이는지 확인한다.

```bash
kubectl get configmaps
kubectl get configmap sample-configmap
```

파일이 정말 저장됐는지 확인하려면 `data`를 출력한다. `-o json`은 결과를 JSON 형식으로 출력하고, 뒤의 `jq .data`는 그중 설정 데이터만 보기 좋게 골라낸다.

```bash
kubectl get configmap sample-configmap -o json | jq .data
```

출력은 다음과 비슷하다.

```json
{
  "nginx.conf": "user nginx;\nworker_processes auto;\nerror_log /var/log/nginx/error.log warn;\npid /var/run/nginx.pid;\n"
}
```

JSON 형식이 익숙하지 않다면 `describe` 명령을 사용해도 된다. 키와 값, 생성 시각 등 사람이 읽기 쉬운 정보를 보여 준다.

```bash
kubectl describe configmap sample-configmap
```

ConfigMap은 Secret처럼 값을 숨기지 않는다. `get`이나 `describe` 결과에 설정값이 그대로 표시될 수 있으므로, 인증 정보 같은 민감한 값은 넣지 않는다.

---

## 4. ConfigMap 값을 환경 변수로 주입하기

이제 ConfigMap을 Pod에서 사용해 보자. Pod의 `env`에서 `configMapKeyRef`를 사용하면 필요한 키를 컨테이너 환경 변수로 전달할 수 있다. 아래 Pod는 `sample-app-config`에서 `APP_MODE`, `LOG_LEVEL` 값을 찾아 같은 이름의 환경 변수로 만든다.

```text
sample-app-config
  ├─ APP_MODE=production ──→ APP_MODE 환경 변수
  └─ LOG_LEVEL=info ───────→ LOG_LEVEL 환경 변수
                                      │
                                      └─ sample-config-env 컨테이너
```

```yaml
# sample-config-env.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-config-env
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - /bin/sh
        - -c
        - |
          echo "mode: $APP_MODE"
          echo "log level: $LOG_LEVEL"
          sleep 3600
      env:
        - name: APP_MODE
          valueFrom:
            configMapKeyRef:
              name: sample-app-config
              key: APP_MODE
        - name: LOG_LEVEL
          valueFrom:
            configMapKeyRef:
              name: sample-app-config
              key: LOG_LEVEL
```

```bash
kubectl apply -f sample-config-env.yaml
kubectl logs sample-config-env
```

출력은 다음과 비슷하다.

```text
mode: production
log level: info
```

ConfigMap의 키가 많고 모두 환경 변수로 사용해도 된다면 `envFrom.configMapRef`를 사용한다. 아래 코드만 컨테이너 설정에 추가하면 된다.

```yaml
envFrom:
  - configMapRef:
      name: sample-app-config
```

이 방식에서는 ConfigMap의 키 이름이 그대로 환경 변수 이름이 된다. 따라서 이름을 바꾸어 가져와야 하거나 꼭 필요한 값만 선택해야 한다면 앞의 `configMapKeyRef` 방식이 더 알맞다. 환경 변수 이름으로 사용할 수 없는 키는 건너뛰며 경고 이벤트가 기록된다.

중요한 점은 ConfigMap을 수정해도 이미 실행 중인 컨테이너의 환경 변수는 바뀌지 않는다는 것이다. 환경 변수는 컨테이너가 시작할 때 한 번 전달되므로, 변경 사항을 반영하려면 Pod를 다시 만들어야 한다.

---

## 5. ConfigMap을 파일로 마운트하기

모든 애플리케이션이 환경 변수로 설정을 받는 것은 아니다. Nginx처럼 설정 파일의 경로를 읽는 애플리케이션이라면 ConfigMap을 **볼륨**으로 마운트하면 된다. 볼륨은 컨테이너 안에서 파일처럼 사용할 수 있는 저장 공간이며, ConfigMap의 각 키는 마운트 경로 아래 파일 하나가 된다.

아래 예제는 `sample-configmap`의 `nginx.conf` 키를 `/etc/nginx-config/nginx.conf` 파일로 제공한다. 예제 컨테이너는 파일 내용을 출력해 정상적으로 전달됐는지 확인한다.

```yaml
# sample-config-volume.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-config-volume
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - /bin/sh
        - -c
        - |
          cat /etc/nginx-config/nginx.conf
          sleep 3600
      volumeMounts:
        # 아래 volumes에서 정의한 nginx-config 볼륨을 컨테이너에 연결한다.
        - name: nginx-config
          # ConfigMap의 각 키는 이 경로 아래 파일 하나로 만들어진다.
          mountPath: /etc/nginx-config
          # 컨테이너에서 설정 파일을 수정하지 못하게 한다.
          readOnly: true
  volumes:
    # Pod에서 사용할 볼륨을 정의한다. 이름은 volumeMounts의 name과 같아야 한다.
    - name: nginx-config
      configMap:
        # 같은 Namespace에 있는 ConfigMap을 이 볼륨의 내용으로 사용한다.
        name: sample-configmap
```

```bash
kubectl apply -f sample-config-volume.yaml
kubectl logs sample-config-volume
kubectl exec sample-config-volume -- ls /etc/nginx-config
```

특정 키만 파일로 만들거나 파일 이름을 바꾸고 싶다면 `items`를 지정한다.

```yaml
volumes:
  - name: nginx-config
    configMap:
      name: sample-configmap
      items:
        - key: nginx.conf
          path: default.conf
```

`key`는 ConfigMap에서 가져올 항목의 이름이고, `path`는 컨테이너 안에서 사용할 파일 이름이다. 즉, ConfigMap의 `nginx.conf` 키를 선택해 `/etc/nginx-config/default.conf` 파일로 보여 주는 설정이다.

```text
ConfigMap의 nginx.conf 키
        ↓
/etc/nginx-config/default.conf 파일
```

`subPath`를 사용하면 이 파일 하나를 컨테이너의 다른 경로에 마운트할 수도 있다. 다만 `subPath` 방식은 ConfigMap이 변경되어도 마운트된 파일이 자동으로 갱신되지 않는다. 처음에는 `items`를 사용해 필요한 키를 선택하고 파일 이름을 정하는 방법을 우선 익히면 된다.

일반적인 ConfigMap 볼륨은 kubelet이 변경을 감지하면 Pod 안의 파일을 시간이 지나 갱신한다. 하지만 파일이 바뀌었다고 해서 애플리케이션이 새 설정을 자동으로 읽는 것은 아니다. Nginx처럼 설정을 다시 읽으려면 reload가 필요한 애플리케이션도 있으므로, 설정을 변경할 때는 재시작 또는 reload 절차도 함께 확인해야 한다.

---

## 6. 운영 시 확인할 점

| 확인 항목 | 이유 |
| --- | --- |
| 기밀 정보 분리 | ConfigMap의 값은 인코딩·마스킹되지 않으므로 비밀번호와 토큰은 Secret에 저장 |
| Namespace 일치 | Pod와 ConfigMap은 같은 Namespace에 있어야 참조 가능 |
| 전달 방식 선택 | 시작 시 읽는 값은 환경 변수, 파일 기반 설정은 볼륨 마운트를 우선 검토 |
| 변경 반영 방식 | 환경 변수는 Pod 재생성이 필요하며, 볼륨은 애플리케이션의 reload 여부를 확인 |
| 크기 제한 | ConfigMap당 최대 1 MiB이므로 큰 파일이나 데이터 저장 용도로 사용하지 않음 |

처음에는 ConfigMap을 "Pod에 설정을 전달하는 상자"라고 생각하면 이해하기 쉽다. 다만 설정을 바꿨다고 즉시 모든 컨테이너가 새 값을 쓰는 것은 아니다. 어떤 방식으로 값을 전달했는지와 애플리케이션이 설정을 다시 읽는 시점을 함께 확인해야 한다.

---

## 7. 정리

ConfigMap은 일반 설정을 키-값 또는 파일 형태로 저장하고, Pod에 환경 변수나 볼륨 파일로 전달하는 Kubernetes 리소스다. 처음에는 `--from-literal`로 간단한 값을 만들어 환경 변수로 읽어 보고, 다음으로 `--from-file`로 설정 파일을 마운트해 보면 흐름을 쉽게 익힐 수 있다.

설정의 성격에 맞춰 전달 방식을 고르고, 변경 시 Pod 재생성 또는 애플리케이션 reload가 필요한지 확인해야 한다. 인증 정보처럼 민감한 값은 ConfigMap이 아니라 Secret으로 분리하는 것이 기본 원칙이다.

---

## 참고 자료

* [Kubernetes 문서 - ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/)
* [Kubernetes 문서 - Configure a Pod to Use a ConfigMap](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/)
