---
layout: post
title: "Argo Rollouts (1) - 개요와 설치하기"
date: 2026-09-22 12:06:20 +0900
categories: ["CI/CD", "Argo Rollouts"]
tags: ["cicd", "argo-rollouts", "kubernetes", "progressive-delivery", "deployment"]
---

## 1. 개요

일반 Kubernetes Deployment를 수정하면 새 ReplicaSet을 만들고, 기본 RollingUpdate 전략에 따라 이전 Pod와 새 Pod를 점진적으로 교체한다. 이 전략은 간단하지만 새 버전을 얼마나 노출할지, 중간에 관찰을 위해 멈출지, 지표가 나쁘면 어떻게 중단할지를 세밀하게 표현하기 어렵다.

Argo Rollouts는 Kubernetes에서 블루-그린과 카나리 같은 점진적 배포(Progressive Delivery)를 수행하는 컨트롤러다. Deployment와 비슷한 `Rollout` 리소스를 사용하되, 새 버전을 제한된 범위에 먼저 노출하고 상태를 확인한 뒤 다음 단계로 진행할 수 있다.

---

## 2. 점진적 배포가 필요한 이유

새 버전을 전체 사용자에게 즉시 배포하면, 배포 직후 발견된 오류가 모든 사용자에게 영향을 줄 수 있다. 점진적 배포는 위험 범위를 줄이기 위해 일부 트래픽 또는 일부 Pod에 새 버전을 먼저 적용한다.

| 전략 | 동작 방식 | 적합한 상황 |
| --- | --- | --- |
| Rolling Update | 기존 Pod와 새 Pod를 순차적으로 교체한다. | 일반적인 무중단 배포 |
| Blue-Green | 기존 버전과 새 버전을 함께 준비한 뒤 트래픽을 한 번에 전환한다. | 빠른 전환과 즉시 롤백이 필요할 때 |
| Canary | 새 버전의 비중을 작게 시작해 단계적으로 높인다. | 실제 트래픽과 지표를 보며 위험을 줄이고 싶을 때 |

Argo Rollouts는 Istio, NGINX Ingress Controller, AWS Load Balancer Controller, Ambassador Edge Stack, SMI 등 트래픽 관리 도구와 연동할 수 있다. Prometheus, Datadog, New Relic 같은 분석 도구에서 지표를 읽어 배포 진행 여부를 판단하는 구성도 가능하다.

트래픽 라우팅 도구를 연결하면 Pod 수 비율을 넘어 요청 비율을 정확하게 제어할 수 있다. 예를 들어 Istio에서는 일부 요청을 Canary에도 복제하는 트래픽 미러링(다크 카나리)을 구성할 수 있다. 다만 요청이 두 버전에 모두 전달되므로, 데이터 변경 API처럼 부작용이 있는 요청에는 그대로 사용하지 않도록 주의한다.

---

## 3. Argo Rollouts의 핵심 리소스

Argo Rollouts를 설치하면 Rollout Controller가 `Rollout` 리소스를 감시한다. Rollout은 Deployment와 마찬가지로 Pod 템플릿과 복제본 수를 가지지만, `strategy`에서 배포 단계를 정의한다.

```text
이미지 또는 Pod 템플릿 변경
        ↓
Rollout Controller가 새 ReplicaSet 생성
        ↓
canary 또는 blueGreen 전략에 정의한 단계 실행
        ↓
승인 · 시간 대기 · 지표 분석 결과에 따라 진행 또는 중단
```

새 버전의 Rollout이 멈춰 있는 동안 이전 안정 버전은 계속 실행될 수 있다. 따라서 운영자는 충분한 관찰 시간을 가진 뒤 수동으로 다음 단계로 진행하거나, 분석 결과를 기준으로 자동 진행하도록 설정할 수 있다.

---

## 4. Argo Rollouts를 설치한다

먼저 컨트롤러 전용 namespace를 만든다.

```bash
kubectl create namespace argo-rollouts
```

공식 설치 매니페스트를 적용한다.

```bash
kubectl apply --namespace argo-rollouts \
  --filename https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
```

컨트롤러 Pod가 정상 실행되는지 확인한다.

```bash
kubectl get pods --namespace argo-rollouts --watch
```

`argo-rollouts` Pod가 `Running` 상태가 되면 `Ctrl+C`로 종료한다. 다음 명령으로 Rollout CRD가 등록되었는지도 확인할 수 있다.

```bash
kubectl api-resources | grep -i rollout
```

출력에 `rollouts`가 보이면 Kubernetes API가 Rollout 리소스를 인식하는 상태다.

---

## 5. CLI 플러그인을 설치하고 상태를 확인한다

Argo Rollouts는 `kubectl argo rollouts` 플러그인을 제공한다. Mac에서 Homebrew를 사용한다면 다음 명령으로 설치한다.

```bash
brew install argoproj/tap/kubectl-argo-rollouts
```

Linux AMD64 환경에서 바이너리를 직접 설치하려면 다음 명령을 사용한다.

```bash
curl -LO https://github.com/argoproj/argo-rollouts/releases/latest/download/kubectl-argo-rollouts-linux-amd64
chmod +x ./kubectl-argo-rollouts-linux-amd64
sudo mv ./kubectl-argo-rollouts-linux-amd64 /usr/local/bin/kubectl-argo-rollouts
```

수동 설치의 경우 macOS Intel 환경에서는 파일명의 `linux-amd64`를 `darwin-amd64`로 바꾼다. Apple Silicon Mac은 Homebrew 설치를 사용하거나, 공식 릴리스에서 현재 CPU 아키텍처에 맞는 바이너리를 선택한다.

플러그인이 준비되면 다음과 같이 Rollout의 상태와 단계를 확인할 수 있다.

```bash
kubectl argo rollouts version
kubectl argo rollouts list rollouts --namespace default
```

CLI는 Rollout의 ReplicaSet, 현재 단계, pause 상태를 읽기 쉽게 보여 준다. 다음 글의 카나리 배포에서는 이 명령으로 새 버전이 어느 단계에 있는지 확인한다.

---

## 6. Dashboard로 Rollout을 확인한다

CLI 플러그인은 로컬 Dashboard도 제공한다. Rollout이 있는 namespace를 지정해 아래 명령을 실행한다.

```bash
kubectl argo rollouts dashboard --namespace bgd
```

명령을 실행한 **같은 머신**의 브라우저에서 `http://localhost:3100/rollouts`에 접속한다. 기본 포트는 `3100`이며, 대시보드 프로세스가 실행 중인 터미널을 종료하면 접속도 끝난다.

`k8s-master`에서 대시보드를 실행했다면 Mac의 `localhost`에서는 바로 보이지 않는다. 서버에서는 위 Dashboard 명령을 유지하고, **Mac의 새 터미널**에서 Tailscale MagicDNS 이름 또는 Tailscale IP를 대상으로 SSH 터널을 연다.

```bash
ssh -N -L 3100:127.0.0.1:3100 etakyung@k8s-master
```

이후 Mac 브라우저에서 `http://localhost:3100/rollouts`로 접속한다. 이 명령은 반드시 Mac에서 실행해야 하며, 대시보드 포트 `3100`을 외부에 직접 열 필요는 없다. Mac에서 `3100`을 이미 사용 중이라면 로컬 포트만 바꿔 `-L 13100:127.0.0.1:3100`으로 실행한 뒤 `http://localhost:13100/rollouts`에 접속한다.

---

## 7. 정리

Argo Rollouts는 Deployment를 대체할 수 있는 Rollout 리소스를 통해 카나리와 블루-그린 배포를 제어한다. 새 버전을 점진적으로 노출하고 중간에 멈출 수 있으므로, 전체 트래픽에 영향을 주기 전에 상태를 확인할 수 있다.

다음 글에서는 Rollout 매니페스트를 작성하고, 카나리 단계에 따라 새 버전을 배포하는 과정을 실습한다.
