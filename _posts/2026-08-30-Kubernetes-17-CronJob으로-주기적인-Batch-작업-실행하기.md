---
layout: post
title: "Kubernetes (17) - CronJob으로 주기적인 Batch 작업 실행하기"
date: 2026-08-30 19:01:54 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "cronjob", "job", "batch", "schedule", "concurrencypolicy", "쿠버네티스"]
---

## 1. CronJob이 필요한 이유

Job은 한 번 실행해 완료하는 Batch **작업을** 관리한다. 백업, 정기 보고서 생성, 이메일 발송, 오래된 데이터 정리처럼 같은 Job을 일정한 주기로 반복해야 한다면 매번 직접 Job을 만들기보다 CronJob을 사용한다.

CronJob은 지정한 스케줄이 될 때마다 Job을 생성하고, 생성된 Job이 다시 Pod를 실행한다. Linux의 crontab 한 줄처럼 동작한다고 생각할 수 있지만, CronJob은 실행을 요청하는 컨트롤러이므로 실제 작업 로직은 `jobTemplate`에 정의한 Job과 Pod에 담는다.

```text
CronJob
    ↓  스케줄 시간이 됨
Job
    ↓
Pod
    ↓
작업 실행 및 종료
```

CronJob은 정확히 한 번 실행되는 것을 보장하는 도구가 아니다. 컨트롤러 상태나 클러스터 상황에 따라 하나의 시각에 Job이 중복 생성되거나 누락될 가능성을 고려해야 하므로, 실제 작업은 여러 번 실행돼도 안전하도록 멱등성(idempotency)을 갖게 만드는 것이 좋다.

---

## 2. `cronjob-exam` 매니페스트 작성하기

다음 예제는 매분 BusyBox 컨테이너를 실행해 `Hello`를 출력하고 10초 대기한 뒤 `Bye`를 출력한다. 실행 중인 이전 Job과 겹치지 않도록 `concurrencyPolicy: Forbid`를 설정했다.

```yaml
# cronjob-exam.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cronjob-exam
spec:
  schedule: "* * * * *"
  startingDeadlineSeconds: 500
  # concurrencyPolicy: Allow
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: hello
              image: busybox
              args:
                - /bin/sh
                - -c
                - echo Hello; sleep 10; echo Bye
          restartPolicy: Never
```

`schedule`은 YAML 문자열로 작성해야 한다. 따옴표 없이 `*`를 쓰면 YAML에서 별칭 문법으로 해석될 수 있으므로, 항상 `"* * * * *"`처럼 감싸는 편이 안전하다.

`jobTemplate.spec` 아래는 Job의 `spec`과 같은 구조다. 그 안의 `template.spec`에 컨테이너와 `restartPolicy`를 작성한다. Job에서와 마찬가지로 CronJob이 만드는 Pod에는 `restartPolicy: Never` 또는 `OnFailure`만 사용할 수 있다.

---

## 3. Cron 스케줄 문법

CronJob의 `schedule`은 공백으로 구분한 5개 필드로 구성된다. 예제의 `* * * * *`는 모든 분에 실행한다는 뜻이다.

```text
# ┌───────────── 분 (0-59)
# │ ┌───────────── 시 (0-23)
# │ │ ┌───────────── 일 (1-31)
# │ │ │ ┌───────────── 월 (1-12)
# │ │ │ │ ┌───────────── 요일 (0-6, 일요일-토요일)
# │ │ │ │ │
# * * * * *
```

| 스케줄 | 의미 |
| --- | --- |
| `* * * * *` | 매분 실행 |
| `0 * * * *` | 매시 정각 실행 |
| `0 3 * * *` | 매일 오전 3시 실행 |
| `0 3 1 * *` | 매월 1일 오전 3시 실행 |
| `0 3 * * 1` | 매주 월요일 오전 3시 실행 |
| `*/10 * * * *` | 10분마다 실행 |

스케줄에 시간대를 직접 넣는 `CRON_TZ` 또는 `TZ` 표현은 사용하지 않는다. 특정 시간대를 명시해야 한다면 CronJob의 `spec.timeZone` 필드를 사용한다.

```yaml
spec:
  timeZone: "Asia/Seoul"
  schedule: "0 3 * * *"
```

시간대를 생략하면 `kube-controller-manager`가 실행되는 환경의 로컬 시간대를 기준으로 해석한다. 실습의 `kubectl get cronjob` 출력에서 `TIMEZONE`이 `<none>`으로 보인 이유도 시간대를 별도로 지정하지 않았기 때문이다.

---

## 4. 지연 시작과 동시 실행 제어

### `startingDeadlineSeconds`

`startingDeadlineSeconds`는 예정 시각을 놓친 Job을 **얼마나 늦게까지 시작할 수 있는지**를 초 단위로 정한다. 작업 자체가 실행할 수 있는 최대 시간을 정하는 필드는 아니다.

예제의 `500`은 스케줄 시각을 놓쳤더라도 500초 이내라면 해당 회차의 Job 생성을 시도한다는 의미다. 그 시간이 지나면 그 회차는 건너뛰고 다음 스케줄은 계속 처리한다. 작업 실행 시간 제한이 필요하다면 `jobTemplate.spec.activeDeadlineSeconds`를 사용한다.

```yaml
jobTemplate:
  spec:
    activeDeadlineSeconds: 60
    template:
      spec:
        # ...
```

### `concurrencyPolicy`

`concurrencyPolicy`는 이전 회차의 Job이 아직 실행 중인데 다음 스케줄 시각이 왔을 때의 처리 방법이다.

| 값 | 동작 | 적합한 경우 |
| --- | --- | --- |
| `Allow` | 이전 Job이 실행 중이어도 새 Job을 생성한다. 기본값이다. | 실행이 겹쳐도 서로 영향이 없는 작업 |
| `Forbid` | 이전 Job이 끝나지 않았으면 새 회차를 건너뛴다. | 백업·정리처럼 동시에 실행하면 안 되는 작업 |
| `Replace` | 실행 중인 이전 Job을 교체하고 새 Job을 시작한다. | 최신 회차만 의미가 있는 작업 |

이 실습의 작업 시간은 10초이고 주기는 1분이므로 보통 이전 Job이 끝난 뒤 다음 Job이 시작된다. 하지만 작업 시간이 1분을 넘기면 `Forbid` 정책은 겹치는 새 회차를 만들지 않는다.

---

## 5. 완료된 Job 보관 개수

CronJob은 매번 새 Job을 만들기 때문에 오래 실행하면 완료된 Job과 Pod가 계속 쌓일 수 있다. `successfulJobsHistoryLimit`과 `failedJobsHistoryLimit`으로 보관할 완료 이력을 제한한다.

```yaml
spec:
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
```

| 필드 | 기본값 | 역할 |
| --- | --- | --- |
| `successfulJobsHistoryLimit` | `3` | 보관할 성공 완료 Job 수 |
| `failedJobsHistoryLimit` | `1` | 보관할 실패 완료 Job 수 |

실습에서 `kubectl get cronjob -o yaml`을 조회했을 때 `successfulJobsHistoryLimit: 3`과 함께 명시하지 않은 `failedJobsHistoryLimit: 1`이 표시된 것은 이 기본값이 적용됐기 때문이다. 값을 `0`으로 설정하면 해당 상태의 완료 Job은 보관하지 않는다.

---

## 6. 생성과 상태 확인

현재 Kubernetes에서는 CronJob에 `batch/v1` API를 사용한다. 실습에서 `batch/v1beta1`으로 적용했을 때 `no matches for kind "CronJob" in version "batch/v1beta1"` 오류가 난 것은 클러스터가 이전 베타 API를 제공하지 않기 때문이다. 매니페스트를 `batch/v1`으로 바꾼 뒤 정상 생성됐다.

```bash
kubectl apply -f cronjob-exam.yaml
kubectl get cronjob
kubectl get jobs
kubectl get pods
```

예제처럼 스케줄을 매분으로 지정하면 CronJob은 분마다 이름 끝에 시간 기반 접미사가 붙은 Job을 만든다. 상태를 상세히 보려면 다음 명령을 사용한다.

```bash
kubectl describe cronjob cronjob-exam
kubectl get cronjob cronjob-exam -o yaml
```

`kubectl get cronjob`의 주요 열은 다음과 같다.

| 항목 | 의미 |
| --- | --- |
| `SCHEDULE` | 설정한 Cron 표현식 |
| `SUSPEND` | 이후 Job 생성을 일시 중지했는지 여부 |
| `ACTIVE` | 현재 실행 중인 Job 수 |
| `LAST SCHEDULE` | 마지막으로 Job을 생성한 시각 |

실습의 YAML 상태에는 `status.active`, `lastScheduleTime`, `lastSuccessfulTime`이 나타났다. `status.active`에 Job 참조가 있으면 해당 CronJob이 만든 Job이 현재 실행 중이라는 뜻이다.

생성된 Job과 Pod의 로그는 Job 이름을 대상으로 확인할 수 있다.

```bash
kubectl get jobs
kubectl logs job/<cronjob이-만든-job-이름>
```

---

## 7. 일시 중지와 삭제

새 Job 생성을 잠시 멈추려면 `suspend: true`로 변경한다. 이미 시작된 Job은 계속 실행되므로, 실행 중인 Job을 즉시 멈추는 기능은 아니다.

```bash
kubectl patch cronjob cronjob-exam -p '{"spec":{"suspend":true}}'
kubectl patch cronjob cronjob-exam -p '{"spec":{"suspend":false}}'
```

CronJob을 삭제할 때는 다음 명령을 사용한다.

```bash
kubectl delete cronjob cronjob-exam
```

CronJob 삭제는 이후의 Job 생성을 중지한다. 이미 생성된 Job을 함께 정리할지 여부는 삭제 방식과 시점에 따라 달라질 수 있으므로, 남아 있는 Job은 `kubectl get jobs`로 확인하고 필요하면 별도로 삭제한다.

---

## 8. 정리

CronJob은 지정한 Cron 스케줄에 맞춰 Job을 반복 생성하는 컨트롤러다. 백업, 보고서 생성, 이메일 발송, 정리 작업처럼 주기적인 Batch 작업에 적합하며, 실제 실행 내용은 `jobTemplate`에 Job 형태로 정의한다.

`startingDeadlineSeconds`는 놓친 회차를 늦게 시작할 수 있는 허용 시간이고, `concurrencyPolicy`는 이전 작업과의 겹침을 제어한다. 또한 완료 이력 제한으로 리소스가 쌓이는 것을 막고, 필요하면 `timeZone`을 명시해 스케줄 기준 시간을 고정해야 한다.

---

## 참고 자료

* [CronJob | Kubernetes 공식 문서](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
