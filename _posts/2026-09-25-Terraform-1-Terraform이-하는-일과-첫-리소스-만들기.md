---
layout: post
title: "Terraform (1) - Terraform이 하는 일과 첫 리소스 만들기"
date: 2026-09-25 14:12:47 +0900
categories: ["Terraform"]
tags: ["terraform", "iac", "hcl"]
---

## 1. 개요

서버, 네트워크, 디스크 같은 인프라를 만들 때 웹 콘솔에서 버튼을 눌러 만들 수도 있다. 하지만 그렇게 만들면 "무엇을 어떻게 만들었는지"가 기록에 남지 않아서, 같은 환경을 다시 만들거나 다른 사람에게 설명하기 어렵다.

**Terraform**은 만들고 싶은 인프라를 코드로 적어 두면, 그 코드대로 인프라를 만들고 고치고 지워 주는 도구다. 이렇게 인프라를 코드로 관리하는 방식을 **IaC**(Infrastructure as Code)라고 한다.

이 글에서는 Terraform이 어떤 방식으로 동작하는지 알아보고, 클라우드 계정 없이 내 컴퓨터에서 파일 하나를 만드는 예제로 기본 흐름을 직접 따라 해 본다.

---

## 2. "무엇이 있어야 하는가"를 적는 도구

Terraform 코드에는 "어떤 순서로 무엇을 실행하라"가 아니라 **"최종적으로 무엇이 있어야 한다"** 를 적는다. 이런 방식을 **선언형**(declarative)이라고 한다.

| 방식 | 적는 내용 | 예 |
| --- | --- | --- |
| 절차형 (셸 스크립트) | 실행할 명령과 순서 | "서버를 만들어라. 그다음 디스크를 붙여라." |
| 선언형 (Terraform) | 최종 상태 | "서버 1대와 디스크 1개가 있어야 한다." |

선언형의 장점은 **같은 코드를 여러 번 실행해도 안전하다**는 것이다. Terraform은 코드에 적힌 상태와 실제 상태를 비교해서 **차이만** 실행한다. 이미 서버가 있으면 새로 만들지 않고, 코드에서 서버를 지우면 실제 서버도 지운다.

---

## 3. 핵심 용어

처음에 알아야 할 용어는 네 가지다.

| 용어 | 뜻 |
| --- | --- |
| **provider** | Terraform이 실제로 무언가를 만들 때 쓰는 플러그인. AWS용, GCP용, 로컬 파일용 등이 따로 있다 |
| **resource** | Terraform이 만들고 관리하는 대상 하나. 서버 1대, 파일 1개가 각각 resource다 |
| **state** | Terraform이 "내가 지금까지 무엇을 만들었는지" 적어 두는 기록 파일 (`terraform.tfstate`) |
| **plan / apply** | plan은 "무엇을 바꿀지" 미리 보여 주고, apply는 실제로 바꾼다 |

전체 흐름은 다음과 같다.

```text
코드(.tf)  ──┐
             ├──> terraform plan  : 코드, state, 실제 상태를 비교해 할 일 계산
state 파일 ──┘         │
                       ▼
                 terraform apply  : provider를 통해 실제로 만들고 바꾸고 지움
                       │
                       ▼
                 state 파일 갱신  : 이번에 만든 것을 기록
```

AWS에 서버를 만드는 코드든, 이 글처럼 파일을 만드는 코드든 흐름은 같다. provider만 다르다.

---

## 4. 설치

macOS에서는 HashiCorp 공식 Homebrew 저장소로 설치한다.

```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
```

Ubuntu 같은 다른 운영체제는 [공식 설치 문서](https://developer.hashicorp.com/terraform/install)의 안내를 따른다. 설치가 끝나면 버전을 확인한다.

```bash
terraform version
# Terraform v1.16.4
```

---

## 5. 첫 코드 작성

실습용 디렉터리를 만들고 그 안에 `main.tf` 파일을 만든다. Terraform 코드 파일은 확장자가 `.tf`다.

```bash
mkdir terraform-practice
cd terraform-practice
```

`main.tf`에 다음 내용을 적는다. 이 코드는 "`hello.txt`라는 파일이 이런 내용으로 있어야 한다"는 선언이다.

```hcl
# main.tf
terraform {
  required_providers {
    local = {                          # 이 코드에서 쓸 provider 이름
      source  = "hashicorp/local"      # 어디서 내려받을지: 로컬 파일을 다루는 공식 provider
      version = "~> 2.5"               # 2.5 이상 3.0 미만 버전 사용
    }
  }
}

resource "local_file" "hello" {        # resource "종류" "이름"
  filename = "${path.module}/hello.txt"   # 만들 파일 경로 (path.module = 이 .tf 파일이 있는 디렉터리)
  content  = "Hello, Terraform!\n"        # 파일 내용
}
```

코드는 **블록** 두 개로 되어 있다.

- `terraform` 블록: 이 코드에 필요한 provider를 적는다. 여기서는 로컬 파일을 만드는 `hashicorp/local`을 쓴다.
- `resource` 블록: 만들 대상을 적는다. 첫 번째 이름 `local_file`은 **리소스 종류**로, provider가 정해 둔 이름 중에서 고른다. 두 번째 이름 `hello`는 코드 안에서 이 리소스를 부르는 **내가 붙인 이름**이다. 이 리소스는 앞으로 `local_file.hello`로 가리킨다.

블록 안의 `이름 = 값` 줄은 **인자**(argument)라고 부른다. 어떤 인자를 쓸 수 있는지는 리소스 종류마다 다르고, [Terraform Registry](https://registry.terraform.io/)의 provider 문서에서 확인한다.

---

## 6. init, plan, apply

### 6.1 init: provider 내려받기

`terraform init`은 코드에 적힌 provider를 내려받는다. 새 디렉터리에서 처음 한 번, provider를 바꿨을 때 다시 실행한다.

```bash
terraform init
```

```text
Terraform has been successfully initialized!
```

실행하면 디렉터리에 두 가지가 생긴다.

- `.terraform/`: 내려받은 provider 파일
- `.terraform.lock.hcl`: 실제로 설치된 provider 버전 기록. 다른 사람도 같은 버전을 쓰도록 git에 함께 올린다

### 6.2 plan: 무엇을 할지 미리 보기

`terraform plan`은 실제로 바꾸지 않고, 코드대로 만들려면 무엇을 해야 하는지만 보여 준다.

```bash
terraform plan
```

```text
Terraform will perform the following actions:

  # local_file.hello will be created
  + resource "local_file" "hello" {
      + content              = <<-EOT
            Hello, Terraform!
        EOT
      + content_md5          = (known after apply)
      + filename             = "./hello.txt"
      + id                   = (known after apply)
      ...
    }

Plan: 1 to add, 0 to change, 0 to destroy.
```

- `+`와 `will be created`: 새로 만든다는 뜻이다.
- `(known after apply)`: 실제로 만들어 봐야 정해지는 값이다. 파일의 해시값이나 id가 그렇다.
- `Plan: 1 to add`: 하나를 만들고, 바꾸거나 지우는 것은 없다.

### 6.3 apply: 실제로 만들기

`terraform apply`는 plan 결과를 한 번 더 보여 주고, `yes`를 입력해야 실행한다.

```bash
terraform apply
```

```text
Do you want to perform these actions?
  Terraform will perform the actions described above.
  Only 'yes' will be accepted to approve.

  Enter a value: yes

local_file.hello: Creating...
local_file.hello: Creation complete after 0s [id=ae9c7cc6...]

Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
```

파일이 만들어졌는지 확인한다.

```bash
cat hello.txt
# Hello, Terraform!

ls
# hello.txt  main.tf  terraform.tfstate
```

`hello.txt`와 함께 `terraform.tfstate`가 새로 생겼다. 이것이 3장에서 말한 state 파일이다.

---

## 7. state: Terraform의 기억

state 파일에는 Terraform이 만든 리소스와 그 속성이 기록된다. 목록은 다음 명령으로 본다.

```bash
terraform state list
# local_file.hello
```

state가 있어서 Terraform은 "이미 만든 것"을 알 수 있다. 같은 코드로 plan을 다시 실행해 보면 할 일이 없다고 나온다.

```bash
terraform plan
```

```text
No changes. Your infrastructure matches the configuration.
```

이번에는 Terraform 밖에서 파일을 직접 지운 뒤 plan을 실행해 본다.

```bash
rm hello.txt
terraform plan
```

```text
  # local_file.hello will be created
Plan: 1 to add, 0 to change, 0 to destroy.
```

state에는 파일이 있다고 기록돼 있지만, 실제로 확인해 보니 없다. 그래서 Terraform은 코드와 맞추기 위해 다시 만들겠다고 한다. `terraform apply`를 실행하면 파일이 다시 생긴다. 이처럼 Terraform은 plan을 실행할 때마다 **코드, state, 실제 상태**를 함께 비교한다.

state 파일은 지우거나 손으로 고치지 않는다. 지우면 Terraform이 자기가 만든 리소스를 잊어버려서, 같은 것을 또 만들려고 한다. 또 state에는 비밀번호 같은 민감한 값이 그대로 들어갈 수 있으므로, 실제 프로젝트에서는 git에 올리지 않고 원격 저장소(S3 같은 **backend**)에 따로 보관한다.

---

## 8. 바꾸고 지우기

### 8.1 코드를 바꿨을 때

`main.tf`의 `content`를 바꾼다.

```hcl
  content  = "Hello again!\n"
```

plan을 실행하면 이번에는 다른 기호가 나온다.

```text
  # local_file.hello must be replaced
-/+ resource "local_file" "hello" {
      ~ content              = <<-EOT # forces replacement
          - Hello, Terraform!
          + Hello again!
        EOT
      ...
    }

Plan: 1 to add, 0 to change, 1 to destroy.
```

`must be replaced`와 `-/+`는 **기존 것을 지우고 새로 만든다**는 뜻이다. `# forces replacement`가 붙은 인자(`content`) 때문에 교체가 일어난다. 파일이라면 문제가 없지만, 서버나 디스크라면 안에 있던 데이터가 사라진다. 그래서 apply 전에 plan을 꼭 확인해야 한다.

plan에 나오는 기호는 네 가지다.

| 기호 | 뜻 | 주의할 점 |
| --- | --- | --- |
| `+` | 새로 만든다 (`will be created`) | |
| `~` | 지우지 않고 속성만 바꾼다 (`will be updated in-place`) | |
| `-/+` | 지우고 새로 만든다 (`must be replaced`) | 데이터가 사라질 수 있다 |
| `-` | 지운다 (`will be destroyed`) | 데이터가 사라진다 |

어떤 인자가 제자리 변경(`~`)이고 어떤 인자가 교체(`-/+`)인지는 리소스 종류마다 다르다. plan이 알려 주므로 외울 필요는 없다.

### 8.2 전부 지우기

실습이 끝나면 `terraform destroy`로 이 코드가 만든 리소스를 모두 지운다. apply처럼 `yes`를 입력해야 실행된다.

```bash
terraform destroy
```

```text
local_file.hello: Destroying... [id=cba977d4...]
local_file.hello: Destruction complete after 0s

Destroy complete! Resources: 1 destroyed.
```

`hello.txt`가 사라진다. `main.tf`는 그대로 있으므로 `terraform apply`를 다시 실행하면 똑같이 다시 만들 수 있다. 코드가 남아 있는 한 인프라는 언제든 다시 만들 수 있다는 것이 IaC의 핵심이다.

---

## 9. 정리

Terraform은 "무엇이 있어야 하는가"를 코드로 선언하는 도구다. 코드는 `terraform`, `resource` 같은 블록과 `이름 = 값` 인자로 이루어지고, 실제로 무언가를 만드는 일은 provider가 한다.

작업 흐름은 `init`(provider 설치) → `plan`(할 일 확인) → `apply`(실행) → `destroy`(정리)다. Terraform은 만든 것을 state 파일에 기록하고, plan을 실행할 때마다 코드, state, 실제 상태를 비교해 차이만 실행한다.

apply 전에는 plan에 `-/+`나 `-`가 있는지 꼭 확인한다. 다음 글에서는 값이 코드에 고정돼 있는 지금의 예제를 변수, 출력, 반복으로 바꿔서 여러 리소스를 한 번에 다루는 방법을 정리한다.
