---
layout: post
title: "Kubernetes (10) - Pod 환경 변수와 Multi-Container 실행 패턴"
date: 2026-08-29 21:50:30 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "pod", "environment-variable", "kubectl-exec", "sidecar", "adapter", "ambassador", "쿠버네티스"]
---

컨테이너 이미지는 여러 환경에서 같은 방식으로 재사용하고, 실행 환경마다 달라지는 값은 Pod 설정으로 분리하는 편이 좋다. Kubernetes의 환경 변수는 애플리케이션의 주소, 실행 모드, 기능 플래그처럼 컨테이너 시작 시 전달할 값을 선언하는 기본적인 방법이다.

이번 글에서는 `MYVAR=testvalue` 환경 변수를 Pod에 설정하고 `kubectl exec`로 확인하는 방법, Multi-Container Pod의 Sidecar·Adapter·Ambassador 실행 패턴을 정리한다.

---

## 1. Pod 환경 변수는 컨테이너별로 설정한다

Pod의 `env`는 컨테이너에 전달할 환경 변수를 지정한다. 같은 Pod 안에 여러 컨테이너가 있더라도 환경 변수는 컨테이너마다 따로 선언해야 하며, 한 컨테이너에 설정한 `env`가 다른 컨테이너에 자동으로 전달되지는 않는다.

`env`로 지정한 값은 이미지에 같은 이름의 환경 변수가 있어도 이를 덮어쓴다. 애플리케이션은 컨테이너가 시작할 때 전달받은 환경 변수를 읽어 동작하므로, 환경 변수만 바꿔도 이미 실행 중인 컨테이너의 프로세스 값이 자동으로 바뀌지는 않는다. 변경을 반영하려면 새 Pod를 만들어야 한다.

---

## 2. `MYVAR=testvalue` 설정하기

다음 매니페스트는 Nginx 컨테이너에 `MYVAR` 환경 변수를 전달한다. 환경 변수 값은 문자열로 작성하는 습관이 안전하며, 특히 숫자·불리언처럼 YAML이 다른 타입으로 해석할 수 있는 값은 따옴표로 감싼다.

```yaml
# pod-nginx-env.yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod-env
spec:
  containers:
    - name: nginx-container
      image: nginx:1.14
      ports:
        - containerPort: 80
          protocol: TCP
      env:
        - name: MYVAR
          value: "testvalue"
```

```bash
kubectl apply -f pod-nginx-env.yaml
kubectl get pod nginx-pod-env

# 컨테이너 환경 변수 전체 출력
kubectl exec nginx-pod-env -- env

# 필요한 값만 확인
kubectl exec nginx-pod-env -- printenv MYVAR
```

출력에는 다음 항목이 포함된다.

```text
MYVAR=testvalue
```

---

## 3. `kubectl exec`로 컨테이너 안에서 확인하기

다음 명령은 실행 중인 `nginx-pod-env` 컨테이너에 대화형 Bash 셸을 연다.

```bash
kubectl exec nginx-pod-env -it -- /bin/bash
```

명령을 나누어 보면 다음과 같다.

| 부분 | 역할 |
| --- | --- |
| `nginx-pod-env` | 접속할 Pod 이름 |
| `-i` | 표준 입력을 유지 (`--stdin`) |
| `-t` | 터미널을 할당 (`--tty`) |
| `--` | `kubectl` 옵션과 컨테이너 안에서 실행할 명령을 구분 |
| `/bin/bash` | 컨테이너 안에서 실행할 셸 |

셸에 들어간 뒤에는 다음처럼 값을 확인할 수 있다.

```bash
echo "$MYVAR"
# testvalue
```

이미지에 Bash가 없으면 `/bin/bash` 실행이 실패할 수 있다. 이때는 이미지에 포함된 `/bin/sh`를 사용하거나, 대화형 셸이 필요하지 않다면 앞에서 본 것처럼 `kubectl exec nginx-pod-env -- printenv MYVAR`로 단일 명령만 실행한다.

Pod에 여러 컨테이너가 있다면 대상 컨테이너를 명시해야 한다.

```bash
kubectl exec -it my-pod -c main-app -- /bin/sh
kubectl exec my-pod -c helper-app -- printenv MYVAR
```

---

## 4. Multi-Container Pod 실행 패턴

여러 컨테이너를 하나의 Pod에 배치할 때는 함께 배포되고 같은 Pod 수명주기를 공유해야 하는 이유가 분명해야 한다. Pod 안의 컨테이너는 네트워크 네임스페이스를 공유하므로 `localhost`로 통신할 수 있지만, 파일 시스템은 기본적으로 분리되어 있다. 파일을 교환하려면 `emptyDir` 같은 공유 볼륨을 명시해야 한다.

| 패턴 | 보조 컨테이너 역할 | 대표 사례 |
| --- | --- | --- |
| Sidecar | 주 애플리케이션에 부가 기능 제공 | 로그 전달, 설정 동기화, 프록시 |
| Adapter | 앱의 출력·인터페이스 형식을 변환 | 로그·메트릭 형식 변환 |
| Ambassador | 외부 서비스와의 연결을 중계 | DB 연결 프록시, 서비스 메시 프록시 |

Sidecar는 앱 옆에서 로그 수집이나 인증 프록시처럼 지속적인 보조 기능을 수행한다. Adapter는 애플리케이션이 만든 로그나 메트릭을 수집 시스템이 이해할 수 있는 형식으로 바꾼다. Ambassador는 주 애플리케이션이 외부 데이터베이스나 원격 서비스의 주소·연결 정책을 직접 알지 않게 하고, `localhost`의 보조 컨테이너로 요청을 보낸다.

```text
앱 컨테이너 → localhost:프록시 포트 → Ambassador → 외부 데이터베이스
앱 컨테이너 → 공유 볼륨의 로그 파일 → Sidecar → 로그 수집 시스템
앱 컨테이너 → 원본 메트릭 → Adapter → 표준화된 메트릭
```

---

## 5. 패턴을 선택할 때 확인할 점

환경 변수는 이미지를 수정하지 않고 실행 환경별 값을 주입하는 데 적합하다. 값이 바뀌었을 때 Pod 재생성이 필요한지 배포 전략과 함께 판단하고, 민감한 값은 매니페스트에 직접 작성하지 않도록 주의한다.

Multi-Container Pod는 컨테이너가 반드시 함께 배포·확장·종료되어야 할 때 선택한다. 서로 독립적인 확장이나 별도 릴리스가 필요한 컴포넌트라면 같은 Pod에 넣기보다 별도 Deployment와 Service로 분리하는 편이 운영하기 쉽다.

---

## 6. 정리

Pod 환경 변수는 `env`로 컨테이너별로 설정할 수 있다. `MYVAR=testvalue`처럼 직접 값을 주입한 뒤 `kubectl exec ... -- printenv MYVAR`로 확인하면, 매니페스트 값이 컨테이너 실행 환경에 반영됐는지 빠르게 검증할 수 있다.

Sidecar·Adapter·Ambassador는 Multi-Container Pod에서 역할을 분리하는 대표 패턴이다. 같은 Pod의 컨테이너는 localhost 네트워크를 공유하지만 파일 시스템은 분리된다는 점을 전제로, 함께 수명주기를 가져야 하는 구성만 묶는 것이 중요하다.

---

## 참고 자료

* [Kubernetes 문서 - Define Environment Variables for a Container](https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/)
* [Kubernetes 문서 - Get a Shell to a Running Container](https://kubernetes.io/docs/tasks/debug/debug-application/get-shell-running-container/)
