---
layout: post
title: "Argo Rollouts (2) - Canary 배포 실습하기"
date: 2026-09-22 12:06:20 +0900
categories: ["CI/CD", "Argo Rollouts"]
tags: ["cicd", "argo-rollouts", "kubernetes", "canary", "progressive-delivery"]
---

## 1. 개요

카나리 배포는 새 버전을 일부에 먼저 적용하고, 오류율·응답 시간·로그처럼 중요한 신호를 확인한 뒤 점차 배포 범위를 넓히는 방식이다. 이번 실습에서는 파란색(`blue`) 버전을 먼저 5개 배포한 뒤, 노란색(`yellow`) 버전을 20%부터 점진적으로 늘린다.

아래 명령은 모두 `k8s-master`에서 실행한다. 1편에서 Argo Rollouts Controller와 `kubectl argo rollouts` 플러그인을 설치한 상태여야 한다. 이 글은 앞선 `bgd` GitOps 실습과 충돌하지 않도록 전용 `rollouts-demo` namespace를 사용한다.

이 예제는 별도 트래픽 관리 도구를 연결하지 않는 학습용 구성이다. 이 경우 새 버전과 이전 버전의 Pod 수 비율로 카나리 비중을 근사한다. 요청 단위의 정확한 트래픽 분할이 필요하다면 Istio나 Ingress Controller 같은 트래픽 라우팅 도구를 추가로 연동해야 한다.

---

## 2. 실습 환경을 확인하고 파일을 준비한다

먼저 Controller와 CLI 플러그인이 정상인지 확인한다. Controller Pod가 `Running`이고 플러그인 버전이 출력되면 다음 단계로 진행한다.

```bash
kubectl get pods --namespace argo-rollouts
kubectl argo rollouts version
```

실습 파일을 둘 디렉터리와 namespace를 준비한다. `--dry-run=client`를 사용했으므로 namespace가 이미 있어도 안전하게 다시 적용할 수 있다.

```bash
export ROLLOUTS_LAB_DIR="$HOME/argo-rollouts-lab"
mkdir -p "$ROLLOUTS_LAB_DIR"
cd "$ROLLOUTS_LAB_DIR"

kubectl create namespace rollouts-demo --dry-run=client --output yaml \
  | kubectl apply --filename -
```

처음부터 다시 실습하려면 마지막 정리 절의 namespace 삭제를 먼저 수행한다. `rollouts-demo` namespace에는 이 글의 실습 리소스만 만들므로, 다른 작업을 넣지 않는다.

---

## 3. Rollout과 Service를 작성하고 초기 버전을 배포한다

다음 명령은 카나리 단계를 가진 `Rollout`을 만든다. 처음 생성할 때는 업데이트가 아니므로 5개의 파란색 Pod가 한 번에 준비된다. `setWeight`와 `pause` 단계는 다음 이미지 변경부터 적용된다.

```bash
cat <<'EOF' > rollout.yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: rollouts-demo
  namespace: rollouts-demo
spec:
  replicas: 5
  revisionHistoryLimit: 2
  selector:
    matchLabels:
      app: rollouts-demo
  template:
    metadata:
      labels:
        app: rollouts-demo
    spec:
      containers:
        - name: rollouts-demo
          image: argoproj/rollouts-demo:blue
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
  strategy:
    canary:
      steps:
        - setWeight: 20
        - pause: {}
        - setWeight: 40
        - pause:
            duration: 30s
        - setWeight: 60
        - pause:
            duration: 30s
        - setWeight: 80
        - pause:
            duration: 30s
EOF

cat <<'EOF' > service.yaml
apiVersion: v1
kind: Service
metadata:
  name: rollouts-demo
  namespace: rollouts-demo
spec:
  type: NodePort
  selector:
    app: rollouts-demo
  ports:
    - name: http
      port: 8080
      targetPort: http
      protocol: TCP
EOF

kubectl apply --filename rollout.yaml
kubectl apply --filename service.yaml
kubectl get rollout,rs,pods,svc --namespace rollouts-demo
```

`kubectl get pods --namespace rollouts-demo --watch`를 실행해 5개 Pod가 모두 `Running`이 될 때까지 기다린 뒤 `Ctrl+C`로 종료한다. 이어서 플러그인 화면으로 Rollout의 안정 상태를 확인한다.

```bash
kubectl argo rollouts get rollout rollouts-demo --namespace rollouts-demo
```

---

## 4. Tailscale로 초기 화면을 확인한다

Service에 `nodePort`를 고정하지 않았으므로, Kubernetes가 비어 있는 NodePort를 자동으로 할당한다. 아래 명령으로 실제 포트와 `k8s-master`의 Tailscale IPv4 주소를 확인한다.

```bash
export ROLLOUTS_NODE_PORT="$(kubectl get svc rollouts-demo --namespace rollouts-demo \
  --output jsonpath='{.spec.ports[0].nodePort}')"
echo "$ROLLOUTS_NODE_PORT"
tailscale ip -4
```

예를 들어 Tailscale IP가 `100.109.113.5`이고 출력된 NodePort가 `31234`라면, 같은 tailnet에 연결된 **Mac의 브라우저**에서 다음 주소를 연다.

```text
http://100.109.113.5:31234
```

초기에는 파란색 화면이 보인다. MagicDNS를 사용한다면 IP 대신 `http://k8s-master:<NodePort>`로도 접속할 수 있다. 이 방식은 NodePort를 통해 노드에 접속하는 것이므로, Pod IP를 Mac 브라우저에 직접 입력하지 않는다.

---

## 5. yellow 버전 카나리 배포를 시작한다

새 이미지로 변경하면 Rollout Controller가 새 ReplicaSet을 만들고 첫 단계인 `setWeight: 20`에서 멈춘다. 아래 명령으로 이미지를 `yellow`로 바꾼다.

```bash
kubectl argo rollouts set image rollouts-demo \
  rollouts-demo=argoproj/rollouts-demo:yellow \
  --namespace rollouts-demo
```

다음 명령은 상태 변화를 계속 표시한다. `Paused` 상태와 `1/5` 수준의 노란색 Pod가 보이면 첫 번째 카나리 단계에 도달한 것이다. 확인한 뒤 `Ctrl+C`로 watch를 종료해도 Rollout은 pause 상태로 유지된다.

```bash
kubectl argo rollouts get rollout rollouts-demo \
  --namespace rollouts-demo \
  --watch
```

새·이전 Pod가 함께 실행되는지도 확인한다.

```bash
kubectl get rs,pods --namespace rollouts-demo \
  --show-labels
```

이 시점에 Mac 브라우저를 여러 번 새로 고치면 파란색과 노란색 화면이 섞여 보일 수 있다. 트래픽 관리 도구가 없는 이 예제에서는 Service가 5개 Pod로 요청을 분산하므로, 이는 정확히 매 요청의 20%를 보장하는 방식은 아니다.

---

## 6. 배포를 진행하거나 중단한다

노란색 버전의 로그와 화면을 확인해 문제가 없으면 수동 pause를 해제한다.

```bash
kubectl argo rollouts promote rollouts-demo --namespace rollouts-demo
kubectl argo rollouts get rollout rollouts-demo \
  --namespace rollouts-demo \
  --watch
```

이후 40%, 60%, 80% 단계는 각각 30초 동안 대기한 뒤 자동으로 다음 단계로 진행한다. 마지막 단계가 끝나면 5개의 Pod가 모두 노란색 버전이 된다. `Healthy`가 표시되면 `Ctrl+C`로 watch를 종료한다.

반대로 첫 번째 수동 pause에서 문제가 발견됐다면 `promote`를 실행하지 말고 아래 명령으로 배포를 중단한다.

```bash
kubectl argo rollouts abort rollouts-demo --namespace rollouts-demo
kubectl argo rollouts get rollout rollouts-demo --namespace rollouts-demo
```

`abort`는 이전 안정 버전인 파란색 ReplicaSet을 다시 활성화하지만, 원하는 이미지 값은 여전히 `yellow`다. 따라서 Rollout 상태는 `Degraded`로 남을 수 있다. 실습을 계속하려면 원하는 상태도 파란색으로 되돌린다.

```bash
kubectl argo rollouts set image rollouts-demo \
  rollouts-demo=argoproj/rollouts-demo:blue \
  --namespace rollouts-demo
```

| 명령 | 용도 |
| --- | --- |
| `get rollout ... --watch` | 단계, pause, ReplicaSet 상태를 계속 확인한다. |
| `promote` | 수동 pause를 해제해 다음 카나리 단계로 진행한다. |
| `abort` | 진행 중인 새 버전 업데이트를 중단하고 이전 안정 버전으로 트래픽을 돌린다. |

---

## 7. Argo CD와 함께 사용할 때

이 글에서는 Rollout Controller의 동작을 바로 확인하기 위해 `kubectl apply`와 `kubectl argo rollouts set image`를 사용했다. 앞선 Argo CD GitOps 실습처럼 Argo CD가 Rollout을 관리한다면, `set image`로 클러스터만 직접 바꾸지 않는다.

대신 `rollout.yaml`을 Git 저장소에 두고 이미지 태그를 수정한 뒤 commit·push한다. Argo CD가 Git 변경을 Sync하면 Rollout Controller가 동일한 카나리 단계를 실행한다.

```text
Git의 rollout.yaml 이미지 태그 변경
        ↓
Argo CD Sync
        ↓
Rollout의 Pod 템플릿 변경
        ↓
Argo Rollouts가 Canary 단계 진행
```

운영 환경에서는 Git의 원하는 상태와 클러스터 상태가 어긋나지 않도록 이 방식을 사용한다.

---

## 8. 실습 리소스를 정리한다

실습을 마쳤다면 아래 명령으로 이 글에서 만든 전용 namespace만 삭제한다.

```bash
kubectl delete namespace rollouts-demo
```

---

## 9. 정리

이 실습에서는 전용 namespace에 Rollout과 NodePort Service를 만들고, 파란색 버전을 노란색 버전으로 카나리 배포했다. `setWeight`와 `pause`로 새 버전의 노출을 나누고, 수동 승인 또는 중단 명령으로 배포 방향을 제어했다.

기본 카나리 전략은 Pod 수로 비중을 근사한다. 실제 운영에서 요청 비율을 정확하게 제어하고 지표에 따라 자동으로 중단하려면 트래픽 라우팅 도구와 Analysis 설정을 추가해야 한다.
