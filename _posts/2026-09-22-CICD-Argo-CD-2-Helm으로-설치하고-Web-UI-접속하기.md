---
layout: post
title: "Argo CD (2) - Helm으로 설치하고 Web UI 접속하기"
date: 2026-09-22 12:06:20 +0900
categories: ["CI/CD", "Argo CD"]
tags: ["cicd", "argocd", "kubernetes", "helm", "gitops"]
---

## 1. 개요

이번 글에서는 Kubernetes 클러스터에 Argo CD를 설치하고, 초기 관리자 비밀번호로 Web UI에 접속한다. 실습에서는 외부 접속을 위해 `argocd-server` Service를 NodePort로 변경한다.

NodePort와 자체 서명 인증서는 학습 환경에서는 간단하지만 운영 환경에 그대로 사용하기에는 적합하지 않다. 운영 환경에서는 Ingress 또는 LoadBalancer와 신뢰할 수 있는 TLS 인증서, 인증 정책을 함께 구성해야 한다.

---

## 2. 설치 전 준비

먼저 `kubectl`이 대상 클러스터와 통신할 수 있는지 확인한다.

```bash
kubectl cluster-info
kubectl get nodes
```

Argo CD 리소스를 다른 애플리케이션과 분리할 `argocd` namespace를 만든다.

```bash
kubectl create namespace argocd
```

이미 같은 namespace가 있다면 명령이 실패한다. 이 경우 다음 명령으로 존재 여부만 확인하고 다음 단계로 진행한다.

```bash
kubectl get namespace argocd
```

---

## 3. Helm으로 Argo CD를 설치한다

Helm 저장소를 추가하고 최신 차트 정보를 받는다.

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
```

이제 `argocd` namespace에 차트를 설치한다.

```bash
helm install argocd argo/argo-cd --namespace argocd
```

설치가 끝날 때까지 Pod 상태를 확인한다.

```bash
kubectl get pods --namespace argocd --watch
```

모든 주요 Pod가 `Running` 상태가 되면 `Ctrl+C`로 watch를 종료한다. 전체 리소스와 Service도 확인한다.

```bash
kubectl get all --namespace argocd
kubectl get svc --namespace argocd
```

Helm 대신 공식 설치 매니페스트를 적용할 수도 있다. 두 방식을 한 클러스터에 함께 적용하면 리소스가 충돌할 수 있으므로 실습에서는 하나만 선택한다.

```bash
kubectl apply --namespace argocd \
  --filename https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

---

## 4. argocd-server를 외부에 노출한다

기본 `argocd-server` Service의 타입은 환경과 Helm 값에 따라 다를 수 있다. 먼저 현재 타입과 포트를 확인한다.

```bash
kubectl get svc argocd-server --namespace argocd
```

로컬 또는 학습용 클러스터에서는 다음 명령으로 Service를 NodePort로 변경할 수 있다.

```bash
kubectl patch svc argocd-server --namespace argocd \
  --type merge \
  --patch '{"spec":{"type":"NodePort"}}'
```

다시 Service를 조회해 HTTPS에 할당된 NodePort를 확인한다.

```bash
kubectl get svc argocd-server --namespace argocd
```

출력이 `443:3xxxx/TCP`와 비슷하다면 `3xxxx`가 외부에서 접근할 포트다. 브라우저에서는 다음 형식으로 접속한다.

```text
https://<KUBERNETES_MASTER_NODE_IP>:<HTTPS_NODE_PORT>
```

자체 서명 인증서를 사용하는 실습 환경에서는 브라우저 경고가 표시될 수 있다. 주소를 무시하고 진행하는 행위는 신뢰할 수 있는 실습 환경에서만 허용하고, 운영 환경에서는 올바른 인증서를 설정한다.

---

## 5. 초기 관리자 비밀번호로 로그인한다

초기 `admin` 계정의 비밀번호는 설치 과정에서 생성된 Secret에 있다. 다음 명령으로 값을 확인한다.

```bash
kubectl --namespace argocd get secret argocd-initial-admin-secret \
  --output jsonpath="{.data.password}" | base64 --decode
```

출력된 값을 복사해 Web UI의 사용자 이름 `admin`으로 로그인한다. 비밀번호는 터미널 기록, 화면 공유, 문서에 남기지 않도록 주의한다. 로그인 직후에는 관리자 비밀번호를 변경하고, 실제 운영에서는 SSO와 최소 권한 RBAC를 적용하는 것이 좋다.

| 확인 항목 | 확인 방법 |
| --- | --- |
| Argo CD Pod 실행 | `kubectl get pods -n argocd` |
| 외부 HTTPS 포트 | `kubectl get svc argocd-server -n argocd` |
| 초기 비밀번호 | `argocd-initial-admin-secret` Secret 조회 |
| Web UI 접속 | `https://<노드 IP>:<NodePort>` |

---

## 6. 정리

Argo CD는 전용 `argocd` namespace에 설치하고, `argocd-server`를 통해 UI와 API를 제공한다. 실습에서는 NodePort로 간단히 접속할 수 있지만, 운영 환경에서는 Ingress, TLS, 인증과 권한 관리가 필수다.
