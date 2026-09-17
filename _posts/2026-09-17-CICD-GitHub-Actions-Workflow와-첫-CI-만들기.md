---
layout: post
title: "GitHub Actions (1) - Workflow와 첫 CI 만들기"
date: 2026-09-17 19:06:17 +0900
categories: ["CI/CD", "GitHub Actions"]
tags: ["github-actions", "ci", "cd", "automation", "yaml"]
---

## 1. 개요

코드를 원격 저장소에 올린 뒤 매번 직접 빌드하거나 테스트를 실행하면, 확인을 빼먹거나 팀원마다 실행 방법이 달라지기 쉽다. GitHub Actions는 저장소에서 일어난 이벤트를 계기로 이런 반복 작업을 자동 실행하는 도구다.

이 글에서는 GitHub Actions를 이루는 단어를 먼저 구분하고, `main` 브랜치에 코드가 올라올 때 실행되는 가장 작은 CI(Continuous Integration) 워크플로를 만든다. 다음 글부터는 이 구조에 Node.js와 Python 테스트를 연결한다.

---

## 2. 워크플로는 이벤트에 반응해 작업을 실행한다

GitHub Actions의 워크플로는 저장소에 함께 커밋하는 YAML 파일이다. 지정한 이벤트가 발생하면 GitHub가 러너(runner)를 준비하고, 워크플로에 정의한 작업을 실행한다. 워크플로 파일은 반드시 저장소의 `.github/workflows` 디렉터리에 둔다.

| 구성 요소 | 하는 일 | 예시 |
| --- | --- | --- |
| Event | 워크플로를 시작시키는 사건 | `push`, `pull_request`, 수동 실행 |
| Workflow | 자동화 절차 전체를 정의한 YAML 파일 | `first-ci.yml` |
| Job | 러너에서 실행할 작업 단위 | 테스트, 이미지 빌드 |
| Step | Job 안에서 순서대로 수행하는 한 단계 | 액션 사용, 명령 실행 |
| Runner | Job을 실행하는 가상 머신 또는 자체 서버 | `ubuntu-latest` |
| Action | 재사용 가능한 Step 구현체 | `actions/checkout@v4` |

하나의 Job 안의 Step은 같은 러너에서 위에서 아래 순서로 실행된다. 반면 Job끼리는 의존 관계를 따로 지정하지 않으면 독립적으로 실행될 수 있다. GitHub의 [워크플로 개요](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows)도 워크플로를 이벤트, Job, Step의 조합으로 설명한다.

---

## 3. 첫 워크플로 파일 만들기

저장소 루트에 `.github/workflows/first-ci.yml` 파일을 만들고 다음 내용을 작성한다. `push`와 풀 리퀘스트가 `main`에 도착할 때 실행하며, 화면에서 직접 실행할 수 있도록 `workflow_dispatch`도 추가했다.

```yaml
name: First CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  hello:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Print message
        run: echo "Hello, GitHub Actions"
```

`name`은 Actions 탭에 표시할 이름이다. `on`에는 실행 조건을, `jobs`에는 실제 일을 적는다. `hello`는 Job의 식별자이며, `runs-on`은 GitHub가 제공하는 Ubuntu 러너를 사용한다는 뜻이다.

`actions/checkout@v4`는 현재 커밋의 소스 코드를 러너 작업 디렉터리로 가져온다. 지금 예제의 `echo`에는 소스 코드가 필요 없지만, 이후 `npm test`나 `pytest`를 실행하려면 반드시 먼저 체크아웃해야 하므로 처음부터 넣어 둔다.

---

## 4. 실행 결과 확인하기

파일을 커밋하고 `main` 브랜치로 푸시한다.

```bash
git add .github/workflows/first-ci.yml
git commit -m "ci: add first GitHub Actions workflow"
git push origin main
```

저장소의 **Actions** 탭에서 `First CI` 실행을 열면 `hello` Job과 두 Step의 성공 여부를 확인할 수 있다. 실패한 경우에는 해당 Step을 열어 표준 출력과 오류 메시지를 확인한다. Job 하나에 서로 관련 없는 일을 지나치게 많이 넣으면 실패 지점을 찾기 어려우므로, 테스트와 배포처럼 목적이 다른 작업은 보통 별도 Job으로 나눈다.

수동 실행을 확인하려면 Actions 탭에서 `First CI`를 선택하고 **Run workflow**를 누른다. `workflow_dispatch`를 설정한 워크플로만 이 방식으로 실행할 수 있다.

---

## 5. 이벤트는 목적에 맞게 고른다

자주 사용하는 이벤트는 다음과 같다.

| 이벤트 | 알맞은 용도 |
| --- | --- |
| `push` | 특정 브랜치에 반영된 코드의 검사 |
| `pull_request` | 병합 전에 변경 사항을 검사 |
| `workflow_dispatch` | 설정 검증이나 운영 작업을 사람이 직접 실행 |
| `schedule` | 정해진 시간에 실행하는 점검 작업 |
| `workflow_call` | 다른 워크플로에서 공통 워크플로를 재사용 |

처음에는 `push`와 `pull_request`만으로 충분하다. 배포처럼 외부에 영향을 주는 작업은 무심코 모든 브랜치에서 실행하지 않도록 `branches: [main]`처럼 대상을 제한하는 편이 안전하다. 이벤트별 세부 조건은 [GitHub 공식 워크플로 문법](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)에서 확인할 수 있다.

---

## 6. 정리

GitHub Actions는 이벤트가 발생하면 워크플로의 Job을 러너에서 실행한다. Job은 여러 Step으로 구성되고, Step은 명령어를 실행하거나 이미 만들어진 Action을 사용할 수 있다.
