---
layout: post
title: "Argo CD (4) - GitHub 매니페스트를 Kubernetes에 동기화하기"
date: 2026-09-22 12:06:20 +0900
categories: ["CI/CD", "Argo CD"]
tags: ["cicd", "argocd", "github", "kubernetes", "gitops", "manifest"]
---

## 1. 개요

앞 글에서는 Helm 차트를 Application으로 배포했다. 이번에는 GitHub 저장소의 `manifest` 디렉터리에 Namespace, Deployment, Service를 저장하고, Argo CD가 이 디렉터리를 읽어 클러스터에 배포하도록 구성한다.

예제 애플리케이션 이름은 `bgd`다. 매니페스트의 리소스 이름, label selector, namespace가 서로 맞아야 Deployment가 만든 Pod를 Service가 올바르게 찾을 수 있다.

---

## 2. Git 저장소와 실습 디렉터리를 준비한다

GitHub에서 **비어 있는 공개 저장소**를 하나 만든다. 이 글에서는 `README`, `.gitignore`, 라이선스를 만들지 않은 저장소를 기준으로 한다. 저장소를 만든 뒤 아래 명령을 실행하고, 프롬프트가 나오면 방금 만든 저장소의 HTTPS 주소를 붙여 넣는다.

```bash
printf '%s' 'GitHub 저장소 HTTPS 주소: '
read -r GITOPS_REPO_URL
export GITOPS_REPO_DIR="$HOME/bgd-gitops"
git clone "$GITOPS_REPO_URL" "$GITOPS_REPO_DIR"
cd "$GITOPS_REPO_DIR"
git switch -c main
mkdir -p manifest
```

이후 명령은 모두 이 디렉터리에서 실행한다. `manifest` 디렉터리에 Namespace, Deployment, Service를 만든다.

```bash
cat <<'EOF' > manifest/00-namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: bgd
EOF

cat <<'EOF' > manifest/10-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bgd
  namespace: bgd
spec:
  replicas: 1
  selector:
    matchLabels:
      app: bgd
  template:
    metadata:
      labels:
        app: bgd
    spec:
      containers:
        - name: bgd
          image: ggnagpae1/bgd:1.0.0
          env:
            - name: COLOR
              value: blue
EOF

cat <<'EOF' > manifest/20-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: bgd
  namespace: bgd
spec:
  type: NodePort
  selector:
    app: bgd
  ports:
    - port: 8080
      protocol: TCP
      targetPort: 8080
      nodePort: 31080
EOF
```

파일이 모두 만들어졌는지 확인한다. `Service.spec.selector.app`과 Deployment Pod 템플릿의 `labels.app`은 모두 `bgd`여야 한다. 이 값이 다르면 Service는 전달할 Pod를 찾지 못한다.

```bash
find manifest -maxdepth 1 -type f -print
```

---

## 3. 매니페스트를 GitHub에 push한다

GitOps에서 Git 저장소는 원하는 상태의 기준이다. 따라서 로컬에서 `kubectl apply`로 먼저 배포하기보다, 작성한 매니페스트를 커밋하고 원격 저장소에 push한다.

```bash
git add manifest
git commit -m "Add bgd Kubernetes manifests"
git push --set-upstream origin main
```

---

## 4. Git 저장소를 바라보는 Application을 만든다

아래 명령은 앞 단계에서 입력한 `GITOPS_REPO_URL`을 사용해 Application을 만든다. `path: manifest`는 저장소 전체가 아니라 `manifest` 디렉터리만 배포 소스로 사용한다는 뜻이다.

```bash
cat <<EOF > bgd-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: bgd-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: ${GITOPS_REPO_URL}
    targetRevision: main
    path: manifest
  destination:
    server: https://kubernetes.default.svc
    namespace: bgd
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
EOF

kubectl apply --filename bgd-app.yaml
kubectl get applications --namespace argocd bgd-app
```

공개 저장소는 별도 인증 없이 Argo CD가 읽을 수 있다. 비공개 저장소를 사용하려면 Application을 만들기 전에 Web UI의 **Settings → Repositories → Connect Repo**에서 GitHub 접근용 자격 증명을 등록한다. 비밀 값은 Application YAML에 직접 기록하지 않는다.

---

## 5. 동기화하고 배포 결과를 확인한다

위 Application에는 자동 동기화 정책을 넣지 않았으므로, 처음에는 `OutOfSync` 상태다. Argo CD Web UI에서 `bgd-app`을 열고 **Sync → Synchronize**를 차례로 눌러 수동 동기화를 시작한다.

동기화가 끝난 뒤 아래 명령을 실행한다. Deployment가 완료되고 EndpointSlice가 출력되면 Service가 Pod를 찾은 것이다.

```bash
kubectl rollout status deployment/bgd --namespace bgd --timeout=5m
kubectl get all --namespace bgd
kubectl get endpointslice --namespace bgd \
  --selector kubernetes.io/service-name=bgd
```

다음 명령으로 Service의 NodePort를 확인한다.

```bash
export BGD_NODE_PORT="$(kubectl get svc bgd --namespace bgd \
  --output jsonpath='{.spec.ports[0].nodePort}')"
echo "$BGD_NODE_PORT"
```

### Tailscale을 통해 Mac에서 접속하기

`k8s-master`와 Mac이 같은 tailnet에 연결되어 있다면, NodePort에 SSH 터널을 추가로 만들 필요가 없다. `k8s-master`에서 아래 명령으로 Tailscale IPv4 주소를 확인한다.

```bash
tailscale ip -4
```

예를 들어 출력이 `100.109.113.5`이고 위에서 확인한 NodePort가 `31080`이라면, **Mac의 브라우저**에서 다음 주소를 연다.

```text
http://100.109.113.5:31080
```

또는 Tailscale MagicDNS를 사용 중이면 IP 대신 노드 이름을 사용할 수 있다.

```text
http://k8s-master:31080
```

NodePort는 노드의 네트워크 인터페이스에서 Service로 트래픽을 전달하므로, Pod IP인 `10.244.x.x` 주소를 Mac 브라우저에 직접 입력하면 안 된다. Pod IP는 클러스터 내부 주소이며 Pod가 다시 생성되면 바뀔 수도 있다. 접속이 되지 않으면 Mac도 같은 tailnet에 연결되어 있는지, 그리고 사용 중인 방화벽이 해당 NodePort의 TCP 연결을 허용하는지 확인한다.

Git 변경을 자동으로 반영하고 싶다면 다음 명령으로 자동 동기화를 켠다.

```bash
kubectl patch application bgd-app --namespace argocd \
  --type merge \
  --patch '{"spec":{"syncPolicy":{"automated":{"prune":true,"selfHeal":true}}}}'
```

자동 동기화는 편리하지만, `prune`은 Git에서 제거된 관리 리소스를 삭제할 수 있다. 운영 환경에서는 Pull Request 검토와 배포 권한 정책을 먼저 갖춘 뒤 사용하는 것이 안전하다.

---

## 6. 이 실습에서 한 일

이 실습은 애플리케이션을 `kubectl apply`로 직접 배포하는 대신, GitHub에 저장한 매니페스트를 원하는 상태의 기준으로 삼고 Argo CD가 그 상태를 Kubernetes에 맞추도록 구성한 것이다.

```text
GitHub manifest 변경 → Argo CD가 main/manifest를 확인 → Kubernetes 리소스 동기화
                                                    → Service(NodePort) → Tailscale → Mac 브라우저
```

| 단계 | 이 실습에서 한 일 | 결과 |
| --- | --- | --- |
| GitHub | `Namespace`, `Deployment`, `Service` 매니페스트를 커밋·push했다 | Git 저장소가 배포할 상태의 기준이 됐다 |
| Argo CD | `bgd-app` Application이 저장소의 `main` 브랜치 `manifest` 경로를 보도록 만들었다 | Argo CD가 Git의 원하는 상태와 클러스터 상태를 비교할 수 있게 됐다 |
| Kubernetes | Sync로 `bgd` Deployment와 Service를 생성하고 EndpointSlice를 확인했다 | Deployment가 Pod를 만들고, Service가 label로 Pod를 찾아 트래픽을 보낼 준비가 됐다 |
| 외부 확인 | NodePort와 `k8s-master`의 Tailscale 주소로 Mac에서 접속했다 | Pod IP를 직접 공개하지 않고 tailnet 안에서 애플리케이션 응답을 확인했다 |

이후 `manifest/10-deployment.yaml`의 `COLOR` 값을 `blue`에서 `green`으로 바꿔 GitHub에 push하면, Argo CD는 이를 새 원하는 상태로 감지한다. 자동 동기화가 꺼져 있다면 Web UI에서 Sync를 실행하고, 켜져 있다면 Argo CD가 Deployment를 갱신한다. 즉, 애플리케이션 설정 변경도 Git 커밋으로 추적하고 재현할 수 있다.

---

## 7. 실습 리소스를 정리한다

실습을 마친 뒤에는 다음 명령으로 클러스터 리소스를 삭제한다. 이 명령은 `bgd` namespace 안의 리소스를 모두 삭제한다. GitHub 저장소는 이후 Git 변경 실습에 사용할 수 있으므로 그대로 둔다.

```bash
kubectl delete application bgd-app --namespace argocd
kubectl delete namespace bgd
```

---

## 8. 정리

GitHub의 `manifest` 디렉터리와 Argo CD Application을 연결하면, Git 커밋이 Kubernetes 배포의 기준이 된다. 수동 동기화로 차이를 검토한 뒤 반영할 수도 있고, 정책을 설정해 Git 변경과 구성 드리프트를 자동으로 처리할 수도 있다.
