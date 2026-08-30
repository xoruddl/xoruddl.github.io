---
layout: post
title: "Kubernetes (16) - Job Controller로 일회성 Batch 작업 완료 보장하기"
date: 2026-08-30 18:35:43 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "job", "job-controller", "batch", "pod", "backofflimit", "activedeadlineseconds", "쿠버네티스"]
---

## 1. Job이 필요한 이유

Deployment, ReplicaSet, DaemonSet은 Pod를 계속 실행 상태로 유지하는 워크로드다. 하지만 데이터 정리, 백업, 마이그레이션처럼 한 번 실행해 성공적으로 끝나면 되는 작업에는 Pod를 계속 살려 둘 필요가 없다.

Job은 이런 **일회성 Batch 작업을 완료할 때까지 관리하는 컨트롤러**다. Job Controller는 Pod가 정상 종료하면 완료로 기록하고, 실패하거나 사라지면 설정한 조건에 따라 재시도해 지정한 성공 횟수를 채운다. 즉, 단순히 Pod를 한 번 만드는 것이 아니라 작업의 성공적인 완료를 목표 상태로 관리한다.

---

## 2. Job Controller의 동작 방식

Job을 생성하면 Job Controller가 Pod 템플릿을 바탕으로 작업 Pod를 만든다. 컨테이너가 종료 코드 `0`으로 끝나면 Pod는 `Succeeded` 상태가 되고, Job은 성공 횟수를 하나 기록한다. 필요한 성공 횟수를 모두 채우면 Job은 `Complete` 상태가 된다.

반대로 Pod가 실패하거나 노드 장애 등으로 사라지면 Job Controller는 실패 횟수와 제한 값을 확인해 다시 실행한다. 따라서 작업 Pod는 정상 종료 뒤에는 재실행하지 않고, 비정상 종료일 때만 재시도 대상이 된다.

```text
Job Object
    ↓
Job Controller
    ↓
작업 Pod 생성 → 성공(Succeeded) → 성공 횟수 기록 → Job Complete
              ↘ 실패(Failed)    → 재시도 조건 확인 → 새 Pod 생성 또는 컨테이너 재시작
```

| 상황 | Job Controller의 처리 |
| --- | --- |
| 컨테이너가 정상 종료 | 성공 완료로 기록하고, 필요한 성공 횟수를 채우면 Job 완료 |
| Pod 또는 컨테이너가 비정상 종료 | `restartPolicy`, `backoffLimit`에 따라 재시도 |
| 실행 제한 시간을 초과 | 실행 중인 Pod를 종료하고 Job을 실패 처리 |
| Job을 삭제 | Job이 생성한 Pod도 함께 삭제 |

완료된 Job의 Pod는 기본적으로 바로 삭제되지 않는다. 완료·실패 원인과 로그를 확인할 수 있도록 남아 있으므로, 정리가 끝난 Job은 직접 삭제하거나 TTL 정책을 설정해 정리할 수 있다.

---

## 3. `centos-job` 매니페스트 작성하기

다음 예제는 CentOS 컨테이너에서 `Hello World`를 출력하고 25초 대기한 다음 `Bye`를 출력하는 Job이다. 다만 Job 전체 실행 시간을 5초로 제한했으므로 실제로는 `Bye`를 출력하기 전에 시간 제한에 걸려 실패한다.

```yaml
# job-exam.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: centos-job
spec:
  # completions: 5
  # parallelism: 2
  activeDeadlineSeconds: 5
  template:
    spec:
      containers:
        - name: centos-container
          image: centos:7
          command: ["bash"]
          args:
            - "-c"
            - "echo 'Hello World'; sleep 25; echo 'Bye'"
      # restartPolicy: Never
      restartPolicy: OnFailure
  # backoffLimit: 3
```

Job의 `spec.template`은 Pod 설계도다. Job Pod의 `restartPolicy`에는 `Always`를 사용할 수 없으며, `Never` 또는 `OnFailure` 중 하나를 지정해야 한다.

`command`와 `args`는 컨테이너 이미지의 기본 명령을 덮어쓴다. 이 예제에서 `command: ["bash"]`, `args: ["-c", "..."]`는 다음과 같은 명령을 실행한다.

```bash
bash -c "echo 'Hello World'; sleep 25; echo 'Bye'"
```

실습 중 `command: ["bashc"]`처럼 잘못 입력하면 컨테이너 명령이 존재하지 않아 실행에 실패한다. `bash`와 `-c`는 각각 `command`와 `args`로 분리해야 한다.

---

## 4. 완료 횟수와 병렬 실행 수

`completions`와 `parallelism`을 생략한 Job은 기본적으로 성공 1회를 목표로 하고 한 Pod씩 실행한다. 주석을 해제해 `completions: 5`, `parallelism: 2`를 설정하면 Job은 성공한 Pod가 총 5개가 될 때까지 실행하되, 동시에 활성 상태인 Pod는 최대 2개로 유지한다.

| 필드 | 예제 값 | 의미 |
| --- | --- | --- |
| `completions` | `5` | Job 완료로 인정할 성공 Pod 횟수 |
| `parallelism` | `2` | 동시에 실행할 수 있는 Pod의 최대 수 |
| 생략 시 | 각각 `1` | Pod 하나가 성공하면 Job 완료 |

예를 들어 `completions: 5`, `parallelism: 2`이면 처음에 최대 2개의 Pod가 실행되고, 하나가 성공할 때마다 Job Controller가 다음 Pod를 만들어 총 5회의 성공을 채운다. `parallelism`은 총 작업 수가 아니라 동시 실행 수라는 점이 중요하다.

---

## 5. 시간 제한, 재시작 정책, 재시도 제한

### `activeDeadlineSeconds`

`activeDeadlineSeconds`는 **Job 전체가 활성 상태로 실행될 수 있는 최대 시간(초)** 이다. 이 값은 개별 컨테이너가 아니라 Job에 적용되며, 여러 Pod가 만들어졌더라도 Job 시작 후의 전체 경과 시간을 기준으로 한다.

이 예제에서는 작업이 25초 걸리는데 제한 시간은 5초이므로, 5초가 지나면 실행 중인 Pod가 종료되고 Job은 `DeadlineExceeded` 이유로 실패한다. 시간 제한은 `backoffLimit`보다 우선하므로, 재시도 중이더라도 제한 시간에 도달하면 더 이상 새 Pod를 만들지 않는다.

```bash
kubectl describe job centos-job
kubectl get job centos-job -o wide
```

`describe` 출력의 `Conditions`와 `Events`에서 `DeadlineExceeded` 또는 Pod 종료 관련 이벤트를 확인할 수 있다.

### `restartPolicy`와 `backoffLimit`

`restartPolicy: OnFailure`는 같은 Pod 안에서 실패한 컨테이너를 kubelet이 재시작하도록 한다. `restartPolicy: Never`는 실패한 컨테이너를 재시작하지 않고 Pod를 실패 상태로 끝내며, Job Controller가 필요하면 대체 Pod를 만든다.

`backoffLimit`은 실패를 몇 번까지 재시도한 뒤 Job을 실패 처리할지 정한다. 생략하면 기본값은 `6`이다. 예제처럼 `backoffLimit: 3`을 지정하면 실패 횟수가 한계에 도달한 Job은 `BackoffLimitExceeded`로 실패한다. 재시도 간 대기 시간은 점진적으로 늘어난다.

| 설정 | 실패 시 동작 | 확인·디버깅 관점 |
| --- | --- | --- |
| `restartPolicy: Never` | 실패 Pod를 끝내고 Job Controller가 대체 Pod를 생성 | 실패한 Pod와 로그를 구분해 보기 쉬움 |
| `restartPolicy: OnFailure` | 같은 Pod에서 컨테이너를 재시작 | 컨테이너 재시작 횟수도 재시도 한도 계산에 반영됨 |
| `backoffLimit: 3` | 실패 한도 도달 뒤 Job 실패 | 무한 재시도를 막음 |

시간 초과 실습을 마친 뒤 정상 완료를 확인하려면 `activeDeadlineSeconds`를 제거하거나 `25`보다 큰 값으로 바꾼다. 변경한 매니페스트로는 새 Job을 만들어야 한다.

---

## 6. 생성, 상태·로그 확인, 삭제

매니페스트를 적용하고 Job과 Pod 상태를 함께 확인한다.

```bash
kubectl apply -f job-exam.yaml
kubectl get jobs
kubectl get pods
```

정상 완료하도록 시간을 조정한 경우에는 Pod 로그에서 두 메시지를 확인할 수 있다.

```bash
kubectl logs job/centos-job

# 또는 Job이 만든 Pod를 선택해 로그 조회
kubectl get pods -l batch.kubernetes.io/job-name=centos-job
kubectl logs <pod-name>
```

작업을 마친 뒤에는 Job 리소스를 삭제한다.

```bash
kubectl delete -f job-exam.yaml
# 또는
kubectl delete job centos-job
```

Job을 삭제하면 그 Job이 소유한 Pod도 함께 삭제된다.

---

## 7. Job 템플릿 수정 시 다시 생성해야 하는 이유

실습 로그에서 기존 `centos-job`에 수정한 YAML을 다시 적용했을 때 다음 오류가 발생했다.

```text
The Job "centos-job" is invalid: spec.template: field is immutable
```

Job은 생성된 Pod가 어떤 명령·이미지·재시작 정책으로 실행됐는지 일관되게 추적해야 하므로, 생성 후에는 `spec.template`의 변경을 허용하지 않는다. 예를 들어 `command: ["bashc"]`를 `command: ["bash"]`로 고치거나 `restartPolicy`를 바꾸는 것은 기존 Job에 적용할 수 없다.

수정한 작업을 실행하려면 기존 Job을 삭제한 뒤 다시 생성한다.

```bash
kubectl delete job centos-job
kubectl apply -f job-exam.yaml
```

반복 실행이 필요하면 같은 이름의 완료된 Job을 재사용하지 말고 삭제 후 생성하거나, 매번 다른 이름을 사용한다. 정기 실행이 목적이라면 Job을 직접 반복 생성하는 대신 CronJob을 사용한다.

---

## 8. 정리

Job은 실행 중인 Pod 수를 계속 유지하는 Deployment와 달리, **작업의 성공적인 종료**를 보장하는 Batch 컨트롤러다. 정상 종료한 Pod는 성공으로 기록하고, 비정상 종료한 Pod·컨테이너는 `restartPolicy`와 `backoffLimit` 조건에 따라 재시도한다.

`completions`는 필요한 성공 횟수, `parallelism`은 동시에 실행할 Pod 수를 정한다. `activeDeadlineSeconds`는 Job 전체의 실행 시간을 제한하며, 시간 초과 시 재시도 한도보다 우선해 Job을 실패 처리한다. 또한 Job의 Pod 템플릿은 생성 후 변경할 수 없으므로 명령이나 이미지 등을 수정했다면 기존 Job을 삭제하고 새로 만들어야 한다.

---

## 참고 자료

* [Jobs | Kubernetes 공식 문서](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
