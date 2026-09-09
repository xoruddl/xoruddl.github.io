---
layout: post
title: "Kubernetes (6) - 환경 변수로 Pod 실행 설정하기"
date: 2026-08-27 12:06:00 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "pod", "environment-variable", "kubectl-exec", "configuration", "쿠버네티스"]
---

컨테이너 이미지는 여러 환경에서 같은 방식으로 재사용하고, 실행 환경마다 달라지는 값은 Pod 설정으로 분리하는 편이 좋다. Kubernetes의 환경 변수는 애플리케이션의 주소, 실행 모드, 기능 플래그처럼 컨테이너 시작 시 전달할 값을 선언하는 기본적인 방법이다.

이번 글에서는 `MYVAR=testvalue` 환경 변수를 Pod에 설정하고 `kubectl exec`로 컨테이너 안의 값을 확인하는 방법을 정리한다. 여러 값을 ConfigMap과 Secret으로 분리하는 방법은 기본 Pod와 Service를 익힌 뒤 별도 글에서 다룬다.

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

## 4. 환경 변수 사용 시 확인할 점

환경 변수는 이미지를 다시 만들지 않고 실행 환경별 값을 주입하는 데 적합하다. 그러나 실행 중인 프로세스의 환경 변수는 매니페스트를 수정하는 즉시 바뀌지 않는다. 컨트롤러를 사용하는 단계에서는 Pod 템플릿을 변경해 새 Pod가 생성되도록 해야 한다.

비밀번호나 토큰 같은 민감한 값을 일반 YAML에 직접 기록하지 않는다. 여러 Pod가 공유하는 일반 설정은 ConfigMap, 민감한 설정은 Secret으로 분리할 수 있으며 19편과 20편에서 각각 다룬다.

---

## 5. 정리

Pod 환경 변수는 `env`로 컨테이너별로 설정할 수 있다. `MYVAR=testvalue`처럼 직접 값을 주입한 뒤 `kubectl exec ... -- printenv MYVAR`로 확인하면, 매니페스트 값이 컨테이너 실행 환경에 반영됐는지 빠르게 검증할 수 있다.

환경 변수는 컨테이너별로 선언되며 같은 Pod의 다른 컨테이너에 자동으로 공유되지 않는다. 다음 글에서는 애플리케이션 컨테이너보다 먼저 실행되는 Init Container와 Pod의 실행 환경을 유지하는 Infra Container를 구분한다.

---

## 참고 자료

* [Kubernetes 문서 - Define Environment Variables for a Container](https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/)
* [Kubernetes 문서 - Get a Shell to a Running Container](https://kubernetes.io/docs/tasks/debug/debug-application/get-shell-running-container/)
