---
layout: post
title: "Jenkins (4) - Pipeline으로 Spring Boot 테스트 자동화하기"
date: 2026-09-19 15:23:44 +0900
categories: ["CI/CD", "Jenkins"]
tags: ["jenkins", "pipeline", "jenkinsfile", "spring-boot", "gradle", "junit", "jacoco"]
---

## 1. 개요

Freestyle Job은 빠르게 시작할 수 있지만, 화면에서 바꾼 빌드 절차는 애플리케이션 코드와 함께 리뷰하거나 버전을 비교하기 어렵다. Jenkins Pipeline은 빌드·테스트·배포 순서를 코드로 작성하고 `Jenkinsfile`로 저장소에 커밋하는 방식이다.

이 글에서는 Declarative Pipeline으로 Spring Boot 프로젝트를 빌드하고 JUnit 결과와 JaCoCo 커버리지 보고서를 Jenkins에서 확인한다.

---

## 2. Jenkinsfile을 저장소에 둔다

Jenkins Pipeline에는 Declarative와 Scripted 문법이 있다. 처음 시작할 때는 구조가 일정하고 읽기 쉬운 Declarative Pipeline을 추천한다. 프로젝트 루트에 확장자 없는 `Jenkinsfile`을 만든다.

| 구성 | 역할 |
| --- | --- |
| `agent` | Pipeline을 실행할 Jenkins 노드 또는 Agent를 정한다. |
| `stages` | Build, Test처럼 큰 실행 단계를 나눈다. |
| `steps` | 각 Stage 안에서 실행할 명령이다. |
| `post` | 성공·실패와 관계없이 실행할 후속 작업이다. |

가장 작은 Declarative Pipeline은 다음과 같다. `pipeline` 블록이 전체 자동화 절차를 감싸고, `stage` 안의 `steps`에 실제 실행할 명령을 둔다.

```groovy
pipeline {
    agent any

    stages {
        stage('Hello') {
            steps {
                echo 'Hello, Jenkins!'
            }
        }
    }
}
```

`agent any`는 사용 가능한 Agent 중 하나에서 작업을 실행한다는 뜻이다. `stage('Hello')`는 화면에 표시될 단계 이름이고, `echo`는 콘솔 로그에 문장을 출력하는 Step이다. `pipeline`, `agent`, `stages`, `stage`, `steps`의 중첩 구조를 먼저 익혀 두면 뒤의 Build·Test·Deploy Pipeline도 같은 방식으로 읽을 수 있다.

Jenkins는 `Jenkinsfile`을 소스 코드와 함께 버전 관리하는 방식을 권장한다. 코드 변경과 자동화 절차의 변경을 같은 풀 리퀘스트에서 검토할 수 있기 때문이다. Pipeline의 기본 구조는 [Jenkins Pipeline 공식 문서](https://www.jenkins.io/doc/book/pipeline/)에서 확인할 수 있다.

---

## 3. Gradle 빌드와 테스트 Pipeline을 작성한다

아래 예제는 JDK 21이 설치된 Agent에서 실행한다. `agent any`는 사용 가능한 Agent를 선택한다는 뜻이므로, 실제 환경에서는 Java와 Gradle 실행 환경이 준비된 label을 지정하는 편이 좋다.

```groovy
pipeline {
    agent any

    options {
        timestamps()
        timeout(time: 15, unit: 'MINUTES')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build') {
            steps {
                sh 'chmod +x gradlew'
                sh './gradlew clean classes --no-daemon'
            }
        }

        stage('Test') {
            steps {
                sh './gradlew test --no-daemon'
            }
        }
    }

    post {
        always {
            junit testResults: 'build/test-results/test/*.xml', allowEmptyResults: true
        }
    }
}
```

Jenkins에서 **New Item → Pipeline**을 선택한 뒤 Pipeline 정의를 **Pipeline script from SCM**으로 설정하고, Git 저장소와 브랜치를 연결한다. Script Path는 기본값인 `Jenkinsfile`을 사용한다. 이후 Job이 실행될 때 Jenkins는 저장소에서 Pipeline 정의를 가져온다.

`junit` Step은 Gradle이 만든 XML 테스트 결과를 Jenkins 화면에 모아 준다. 테스트가 실패해도 `post { always }`는 실행되므로, 실패한 테스트 이름과 추세를 확인할 수 있다.

---

## 4. JaCoCo로 테스트 범위를 확인한다

코드 커버리지는 테스트가 실행한 코드의 비율을 보여 주는 지표다. 높은 수치가 곧 좋은 테스트를 뜻하지는 않지만, 테스트되지 않은 분기나 클래스를 발견하는 데 도움이 된다.

Gradle Groovy DSL 프로젝트라면 `build.gradle`에 JaCoCo 플러그인과 최소 기준을 추가할 수 있다.

```groovy
plugins {
    id 'java'
    id 'jacoco'
}

jacocoTestCoverageVerification {
    violationRules {
        rule {
            limit {
                counter = 'LINE'
                value = 'COVEREDRATIO'
                minimum = 0.20
            }
        }
    }
}

check.dependsOn jacocoTestCoverageVerification
```

커버리지 검증과 HTML 보고서를 만들도록 Test Stage를 바꾼다.

```groovy
stage('Test') {
    steps {
        sh './gradlew test jacocoTestReport jacocoTestCoverageVerification --no-daemon'
    }
}
```

`minimum = 0.20`은 학습용 예시다. 처음부터 100%를 목표로 두면 의미 없는 테스트가 늘어날 수 있다. 오류가 자주 나거나 중요한 비즈니스 규칙부터 테스트하고, 팀이 관리 가능한 기준을 점진적으로 높이는 편이 좋다.

---

## 5. 실패를 읽는 방법

Pipeline 화면에서 어느 Stage가 실패했는지 먼저 확인하고, 해당 Build의 Console Output을 연다. Gradle 테스트가 실패했다면 JUnit 결과를 열어 실패한 테스트 이름과 예상·실제 값을 확인한다. 커버리지 기준 실패는 JaCoCo HTML 보고서인 `build/reports/jacoco/test/html/index.html`에서 실행되지 않은 라인과 분기를 확인한다.

빌드 결과물이나 HTML 보고서도 보관해야 한다면 `post` 블록에 `archiveArtifacts`를 추가할 수 있다.

```groovy
post {
    always {
        junit testResults: 'build/test-results/test/*.xml', allowEmptyResults: true
        archiveArtifacts artifacts: 'build/reports/jacoco/test/html/**', allowEmptyArchive: true
    }
}
```

보관 기간과 개수는 Job 설정에서 제한한다. 보고서는 유용하지만, 모든 Build의 산출물을 영구 보관하면 Controller 저장 공간이 빠르게 늘어난다.

---

## 6. 정리

Pipeline은 빌드 절차를 `Jenkinsfile`로 관리해 변경 이력과 코드 리뷰를 가능하게 한다. Declarative Pipeline의 `stage`로 Checkout, Build, Test를 분리하면 실패 위치도 분명해진다.

JUnit 결과와 JaCoCo 보고서를 함께 남기면 단순 성공·실패를 넘어 테스트 품질을 확인할 수 있다.
