---
layout: post
title: "Argo CD (3) - Application으로 Helm 차트 배포하기"
date: 2026-09-22 12:06:20 +0900
categories: ["CI/CD", "Argo CD"]
tags: ["cicd", "argocd", "kubernetes", "helm", "application"]
---

## 1. 개요

Argo CD의 `Application`은 배포할 소스와 대상 클러스터를 연결하는 핵심 리소스다. 이번 글에서는 Bitnami NGINX Helm 차트를 예시로 Application을 만들고, 자동 동기화와 구성 드리프트 처리 옵션을 살펴본다.

Helm을 직접 설치하는 것과 달리, 이 방식에서는 Argo CD가 차트를 렌더링하고 클러스터 상태를 계속 추적한다. 따라서 UI와 CLI에서 원하는 상태와 실제 상태의 차이를 확인할 수 있다.

---

## 2. Application 리소스의 구조

Application은 `argocd` namespace에 만들며, 크게 source와 destination을 지정한다.

| 항목 | 역할 |
| --- | --- |
| `source` | Git 저장소 또는 Helm 저장소, 사용할 경로·차트·버전을 지정한다. |
| `destination` | 배포 대상 Kubernetes API 서버와 namespace를 지정한다. |
| `syncPolicy` | 동기화를 자동으로 수행할지, Git에 없는 리소스를 정리할지 정한다. |

다음 예제의 NGINX는 Helm 차트 저장소에서 가져오며, 대상은 현재 Argo CD가 설치된 클러스터의 `nginx-deploy` namespace다.

---

## 3. Helm 차트를 배포할 Application을 작성한다

이전 글에서 Argo CD 설치를 마쳤다고 가정한다. 아래 명령은 실습 디렉터리를 만들고 `application.yaml`을 생성한다. 터미널에 그대로 붙여 넣는다.

```bash
mkdir -p "$HOME/argocd-lab"
cd "$HOME/argocd-lab"

cat <<'EOF' > application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: nginx-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://charts.bitnami.com/bitnami
    chart: nginx
    targetRevision: 22.6.5
    helm:
      releaseName: nginx-app
      parameters:
        - name: replicaCount
          value: "2"
  destination:
    server: https://kubernetes.default.svc
    namespace: nginx-deploy
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
EOF
```

`targetRevision`은 사용할 Helm 차트 버전이다. 학습 중 재현 가능한 결과를 위해 특정 버전을 고정했다. 최신 차트를 사용하고 싶다면 Helm 저장소에서 호환되는 차트 버전과 values를 확인한 뒤 값을 함께 조정해야 한다.

`replicaCount`는 차트의 기본값을 덮어쓴다. 이처럼 차트가 제공하는 설정 이름은 차트마다 다르므로, 임의로 추측하지 말고 해당 차트의 values 문서를 확인한다.

---

## 4. 자동 동기화 옵션을 이해한다

위 Application은 `automated`를 사용하므로, Argo CD가 변경을 감지했을 때 동기화를 수행할 수 있다. 각 설정이 하는 일은 다음과 같다.

| 설정 | 의미 |
| --- | --- |
| `automated` | Git 또는 차트에서 읽은 원하는 상태와 실제 상태가 다를 때 자동 동기화를 허용한다. |
| `prune: true` | Git 또는 차트 결과에 더 이상 없는, Argo CD가 관리하던 리소스를 동기화 시 정리한다. |
| `selfHeal: true` | 누군가 클러스터 리소스를 직접 바꿔 발생한 드리프트를 선언 상태로 되돌린다. |
| `CreateNamespace=true` | 대상 namespace가 없으면 동기화 과정에서 생성한다. |

`prune`과 `selfHeal`은 편리하지만 실제 리소스를 변경하거나 삭제할 수 있다. 특히 운영 환경에서는 Application Project, RBAC, 동기화 창과 검토 절차를 함께 설정하고, 어떤 리소스가 관리 대상인지 분명히 해야 한다.

---

## 5. Application을 적용하고 상태를 확인한다

Application 리소스를 적용한다. `automated` 정책이 있으므로 별도의 Sync 버튼을 누르지 않아도 Argo CD가 차트를 동기화한다.

```bash
kubectl apply --filename application.yaml
kubectl get applications --namespace argocd nginx-app --watch
```

출력에서 `Synced`, `Healthy`가 보이면 `Ctrl+C`로 watch를 종료한다. 이어서 Deployment가 두 개의 Pod를 준비할 때까지 기다린다.

```bash
kubectl rollout status deployment/nginx-app \
  --namespace nginx-deploy \
  --timeout=5m
kubectl get all --namespace nginx-deploy
```

NGINX의 응답까지 확인하려면 Argo CD와 같은 클러스터에 연결된 터미널에서 다음 명령을 실행한다. 이 명령은 실행 중인 동안 해당 터미널을 사용하므로, 종료할 때는 `Ctrl+C`를 누른다.

```bash
kubectl port-forward --namespace nginx-deploy svc/nginx-app 8081:80
```

`kubectl port-forward`를 Mac에서 실행했다면 브라우저에서 `http://localhost:8081`에 접속한다. `k8s-master`에 SSH 접속해 명령을 실행했다면 Mac의 `localhost`에는 바로 연결되지 않는다. 이 경우 Mac의 새 터미널에서 Tailscale SSH 터널을 연다.

```bash
ssh -N -L 8081:127.0.0.1:8081 etakyung@k8s-master
```

위 명령의 `k8s-master`는 Tailscale MagicDNS 이름이다. MagicDNS를 사용하지 않는다면 `k8s-master` 대신 해당 노드의 Tailscale IP를 입력한다. SSH 터널을 실행한 터미널도 유지한 뒤 Mac 브라우저에서 `http://localhost:8081`에 접속한다. NGINX 페이지가 보이면 배포가 완료된 것이다.

Web UI에서도 `nginx-app`을 열어 Sync Status와 Health Status를 확인한다. `Synced`는 차트에서 계산한 원하는 상태와 현재 상태가 일치함을, `Healthy`는 리소스가 정상 동작 상태로 판단됨을 의미한다. 두 상태는 다른 개념이므로 함께 확인해야 한다.

## 6. 이 실습에서 한 일

이 실습에서 직접 NGINX를 설치한 주체는 사용자가 아니라 Argo CD다. `nginx-app` Application에 "어느 차트를, 어디에, 어떤 설정으로 배포할지"를 선언했고, Argo CD가 그 선언을 읽어 Kubernetes 리소스를 만들었다.

| 만든 것 | 의미 |
| --- | --- |
| `nginx-app` Application | Argo CD가 관리하는 배포 단위다. `argocd` namespace에 생성된다. |
| NGINX Helm 차트 배포 | Argo CD가 Bitnami Helm 저장소에서 차트 `22.6.5`를 받아 Kubernetes 매니페스트로 렌더링한다. |
| `nginx-deploy` namespace | 렌더링된 NGINX Deployment, Service, Pod가 배포되는 대상 namespace다. |
| NGINX Pod 2개 | `replicaCount: "2"` 설정에 따라 실행되는 애플리케이션 인스턴스다. |
| 자동 동기화 정책 | 차트의 원하는 상태와 클러스터 상태가 달라지면 Argo CD가 상태를 다시 맞춘다. |

따라서 이 방식은 터미널에서 `helm install`을 한 번 실행하고 끝내는 배포와 다르다. Argo CD가 차트 버전과 설정을 기준으로 상태를 계속 비교하고, Web UI에서 그 결과를 `Synced`와 `Healthy` 상태로 보여 준다.

## 7. 실습 리소스를 정리한다

다음 글의 실습과 독립적으로 진행하려면 NGINX Application과 namespace를 삭제한다. 이 명령은 `nginx-deploy` namespace 안의 리소스를 모두 삭제한다.

```bash
kubectl delete application nginx-app --namespace argocd
kubectl delete namespace nginx-deploy
```

---

## 8. 정리

Application은 소스, 대상 클러스터, 동기화 정책을 한 리소스로 정의한다. Helm 차트의 값도 Application에서 선언할 수 있으며, Argo CD는 그 결과와 클러스터 상태를 지속적으로 비교한다.
