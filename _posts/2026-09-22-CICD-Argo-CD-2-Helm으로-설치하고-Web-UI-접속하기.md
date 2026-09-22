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

이 글의 명령은 **Argo CD를 설치할 클러스터에 연결된 터미널**에서 실행한다. 먼저 현재 `kubectl` 컨텍스트, 노드, Helm 설치 여부를 한 번에 확인한다.

```bash
kubectl config current-context
kubectl get nodes -o wide
helm version
```

`kubectl get nodes`의 `STATUS`가 모두 `Ready`인지 확인한다. 이후 Web UI에 접속할 때는 여기서 나온 노드 IP 중 브라우저가 접근할 수 있는 IP를 사용한다.

---

## 3. Helm으로 Argo CD를 설치한다

아래 명령은 namespace가 없으면 만들고, 이미 설치한 적이 있어도 같은 릴리스를 갱신한다. 따라서 중간에 실패한 뒤 다시 실행해도 된다.

```bash
helm repo add argo https://argoproj.github.io/argo-helm --force-update
helm repo update
helm upgrade --install argocd argo/argo-cd \
  --namespace argocd \
  --create-namespace \
  --wait \
  --timeout 10m
```

설치가 완료되면 주요 Pod와 Helm 릴리스를 확인한다.

```bash
kubectl get pods --namespace argocd
helm list --namespace argocd
```

모든 Pod가 `Running` 또는 `Completed`가 될 때까지 기다린다. 일부 Pod가 계속 `Pending` 또는 `CrashLoopBackOff`라면 다음 단계로 진행하지 말고 해당 Pod의 이벤트를 확인한다.

```bash
kubectl get pods --namespace argocd
kubectl get events --namespace argocd --sort-by='.lastTimestamp'
```

---

## 4. argocd-server를 외부에 노출한다

기본 `argocd-server` Service의 타입은 환경과 Helm 값에 따라 다를 수 있다. 먼저 현재 타입과 포트를 확인한다.

```bash
kubectl get svc argocd-server --namespace argocd
```

학습용 클러스터에서는 다음 명령으로 Service를 NodePort로 변경한다. 이미 NodePort라면 같은 명령을 다시 실행해도 된다.

```bash
kubectl patch svc argocd-server --namespace argocd \
  --type merge \
  --patch '{"spec":{"type":"NodePort"}}'
```

다음 명령은 HTTPS(443)에 할당된 NodePort를 변수에 저장하고 화면에 출력한다.

```bash
export ARGOCD_HTTPS_NODE_PORT="$(kubectl get svc argocd-server --namespace argocd \
  --output jsonpath='{range .spec.ports[?(@.port==443)]}{.nodePort}{end}')"
echo "$ARGOCD_HTTPS_NODE_PORT"
```

화면에 출력된 포트가 비어 있지 않은지 확인한다. 브라우저에서는 다음 형식으로 접속한다.

```text
https://<Tailscale-IP-또는-접근-가능한-노드-주소>:<출력된-HTTPS-NodePort>
```

예를 들어 NodePort가 `30443`이고 Tailscale IP가 `100.64.0.10`이라면 `https://100.64.0.10:30443`으로 접속한다. MagicDNS를 사용한다면 IP 대신 해당 노드의 MagicDNS 이름을 사용해도 된다. 자체 서명 인증서를 사용하는 실습 환경에서는 브라우저 경고가 표시될 수 있다. 이 경고를 무시하는 것은 신뢰할 수 있는 실습 환경에서만 허용한다.

---

## 5. 초기 관리자 비밀번호로 로그인한다

초기 `admin` 계정의 비밀번호는 설치 과정에서 생성된 Secret에 있다. 다음 명령은 비밀번호만 출력한다.

```bash
kubectl --namespace argocd get secret argocd-initial-admin-secret \
  --output jsonpath="{.data.password}" | base64 --decode
```

출력된 값을 복사해 Web UI의 사용자 이름 `admin`으로 로그인한다. 로그인 후에는 화면에 `Applications` 페이지가 보이는지 확인한다. 비밀번호는 터미널 기록, 화면 공유, 문서에 남기지 않도록 주의한다. 로그인 직후에는 관리자 비밀번호를 변경하고, 실제 운영에서는 SSO와 최소 권한 RBAC를 적용하는 것이 좋다.

| 확인 항목 | 확인 방법 |
| --- | --- |
| Argo CD Pod 실행 | `kubectl get pods -n argocd` |
| 외부 HTTPS 포트 | `echo "$ARGOCD_HTTPS_NODE_PORT"` |
| 초기 비밀번호 | `argocd-initial-admin-secret` Secret 조회 |
| Web UI 접속 | `https://<노드 IP>:<NodePort>` |

---

## 6. 정리

Argo CD는 전용 `argocd` namespace에 설치하고, `argocd-server`를 통해 UI와 API를 제공한다. 다음 글에서도 이 설치를 계속 사용하므로 아직 삭제하지 않는다. 실습에서는 NodePort로 간단히 접속할 수 있지만, 운영 환경에서는 Ingress, TLS, 인증과 권한 관리가 필수다.
