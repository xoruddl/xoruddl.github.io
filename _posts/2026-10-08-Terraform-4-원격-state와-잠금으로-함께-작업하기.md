---
layout: post
title: "Terraform (4) - 원격 state와 잠금으로 함께 작업하기"
date: 2026-10-08 19:58:24 +0900
categories: ["Terraform"]
tags: ["terraform", "iac", "state", "backend"]
---

## 1. 개요

[이전 글](/posts/Terraform-3-AWS-S3-버킷으로-실제-인프라-관리하기/)에서는 S3 버킷을 만들었다. 그 작업 기록인 `terraform.tfstate`는 실행한 컴퓨터에 저장됐다. 다른 사람이 같은 코드를 받아 실행해도 그 기록이 없으면 기존 버킷을 Terraform이 관리 중인지 알 수 없다.

여러 사람이 작업하려면 state를 공유하고, 한 사람이 변경하는 동안 다른 사람이 동시에 쓰지 못하도록 **잠금**을 걸어야 한다. 이 글에서는 S3 backend로 state를 옮기는 흐름을 정리한다.

---

## 2. state와 backend의 역할

**state**는 코드의 리소스 주소와 실제 인프라 객체의 연결을 기록한다. **backend**는 이 state를 어디에 저장하고 어떻게 접근할지 정한다.

| 방식 | 저장 위치 | 협업할 때 |
| --- | --- | --- |
| 기본 local backend | 실행한 컴퓨터의 `terraform.tfstate` | 파일 공유와 동시 수정 관리가 어렵다 |
| S3 backend | 지정한 S3 버킷의 객체 | 여러 사람이 같은 state를 사용하고 잠금을 설정할 수 있다 |

state에는 암호 같은 값이 포함될 수 있다. `sensitive = true`는 터미널 출력을 가리지만 state에서 값을 제거하지는 않는다. 접근 권한, 암호화, 백업을 state에도 적용해야 한다. [민감 정보 관리 문서](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)

---

## 3. state용 버킷 준비

3편의 **실습 리소스 버킷과 별도로** state 저장용 버킷을 미리 준비한다. backend는 `terraform init` 단계에서 필요하므로, 같은 구성으로 관리하는 리소스가 아직 만들어지기 전에는 그 리소스를 backend로 사용할 수 없다.

예제에서는 `my-tfstate-123456789012`라는 이름을 사용한다. 실제로는 본인 소유의 고유한 버킷 이름으로 바꾼다. 버킷에는 버전 관리를 켜서 실수로 덮어쓴 state를 복구할 수 있게 하고, 접근 권한을 작업자에게만 준다. 아래 구성은 **버킷이 이미 준비된 뒤** 3편의 `main.tf`에 추가한다.

```hcl
terraform {
  backend "s3" {
    bucket       = "my-tfstate-123456789012"
    key          = "practice/s3-bucket/terraform.tfstate"
    region       = "ap-northeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
```

이미 파일에 `terraform` 블록이 있다면 위 `backend "s3"` 블록을 그 안에 넣는다. `key`는 버킷 안에서 state 객체를 저장할 경로다. 서로 다른 프로젝트는 서로 다른 `key`를 써야 한다.

`use_lockfile = true`는 state를 쓰는 동안 S3 잠금 파일을 사용한다. 작업자에게는 state 객체의 읽기·쓰기와 잠금 파일의 읽기·쓰기·삭제 권한이 필요하다. 구체적인 권한은 [S3 backend 문서](https://developer.hashicorp.com/terraform/language/backend/s3)에서 확인한다.

---

## 4. 로컬 state 옮기기

3편의 리소스가 아직 존재하고 로컬 `terraform.tfstate`도 있는 디렉터리에서 실행한다. **현재 state를 백업**한 뒤 초기화 명령으로 이전한다. 백업 파일에도 민감 정보가 있을 수 있으므로 안전한 곳에만 둔다.

```bash
cp terraform.tfstate terraform.tfstate.backup
terraform init -migrate-state
```

Terraform이 기존 state를 새 backend로 옮길지 묻는다. 버킷 이름과 `key`를 확인하고 진행한다. 이전 후에는 다음 두 명령으로 기존 관리 대상과 변경 계획을 확인한다.

```bash
terraform state list
terraform plan
```

3편의 구성을 바꾸지 않았다면 `plan`은 변경할 것이 없다고 알려야 한다. 새 버킷을 만들겠다는 계획이 나오면 적용하지 말고, backend의 `bucket`·`key`와 이전 결과를 확인한다.

---

## 5. 협업할 때 지킬 규칙

- 같은 인프라를 관리하는 작업자는 같은 backend 설정과 같은 `key`를 사용한다.
- `terraform plan`을 검토한 뒤 `apply`한다. 잠금이 있어도 서로 다른 변경이 의도와 맞는지는 사람이 확인해야 한다.
- state 파일과 비밀 값이 든 `terraform.tfvars`는 Git에 올리지 않는다. `.terraform.lock.hcl`은 provider 버전을 맞추기 위해 함께 관리한다.
- 잠금 오류가 나면 실제로 다른 작업이 진행 중인지 먼저 확인한다. 잠금 파일을 임의로 지우거나 `force-unlock`을 습관적으로 쓰지 않는다.

S3 backend의 잠금 파일 기능은 opt-in이다. 이전 자료에서 보이는 DynamoDB 잠금 방식은 현재 공식 문서에서 더 이상 권장하지 않는다. 새 실습은 S3 잠금 파일을 기준으로 구성한다.

---

## 6. 정리

backend는 state의 저장 위치를 정한다. S3 backend에 잠금과 접근 제어를 설정하면 여러 사람이 같은 state를 사용할 수 있다. 로컬 state를 옮길 때는 `terraform init -migrate-state`를 실행하고, 바로 `terraform state list`와 `terraform plan`으로 결과를 확인한다.

다음 글에서는 코드도 여러 곳에서 재사용할 수 있도록 [module](/posts/Terraform-5-module로-인프라-구성-재사용하기/)로 분리한다.

참고: [Terraform S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3), [State와 backend](https://developer.hashicorp.com/terraform/language/state/backends)
