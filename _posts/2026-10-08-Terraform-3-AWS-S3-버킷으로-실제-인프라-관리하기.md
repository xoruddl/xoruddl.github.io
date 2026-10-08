---
layout: post
title: "Terraform (3) - AWS S3 버킷으로 실제 인프라 관리하기"
date: 2026-10-08 19:57:38 +0900
categories: ["Terraform"]
tags: ["terraform", "iac", "aws", "s3"]
---

## 1. 개요

[이전 글](/posts/Terraform-2-변수-출력-반복으로-여러-리소스-다루기/)까지는 내 컴퓨터의 파일을 만들었다. 이번에는 같은 `init → plan → apply` 흐름으로 AWS의 S3 버킷을 만든다. **리소스**는 Terraform이 만들고 관리하는 대상이고, AWS 계정 정보처럼 이미 존재하는 값을 읽을 때는 **data source**를 쓴다.

이 실습에는 AWS 계정과 버킷을 만들 권한이 필요하다. AWS 리소스에는 비용이 발생할 수 있으므로 실습을 마치면 결과를 확인하고 삭제한다. 예제 버킷에는 실제 데이터를 넣지 않는다.

---

## 2. 실습 준비

새 디렉터리를 만든다. 1·2편과 분리하면 state도 분리된다.

```bash
mkdir terraform-aws-bucket
cd terraform-aws-bucket
```

AWS 인증 정보는 Terraform 코드에 적지 않는다. 기존 AWS CLI 프로필이나 환경 변수를 통해 제공한다. 인증이 되는지 확인할 수 있다면 다음 명령으로 현재 계정을 확인한다.

```bash
aws sts get-caller-identity
```

`aws` 명령이 없다면 [AWS CLI 설치 안내](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)를 참고한다. Terraform의 AWS provider도 표준 AWS 인증 방법을 사용한다. 다른 계정에서 실행하면 예상하지 못한 곳에 리소스가 생길 수 있으므로 계정과 리전을 먼저 확인한다.

---

## 3. provider와 입력값 작성

`main.tf`를 만든다. `required_providers`는 사용할 플러그인을 지정하고, `provider` 블록은 이 플러그인이 접근할 리전을 정한다.

```hcl
# main.tf
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "실습 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "bucket_name" {
  description = "전 세계에서 고유한 실습용 S3 버킷 이름"
  type        = string
}
```

S3 버킷 이름은 전 세계에서 고유해야 한다. `terraform.tfvars`에 **본인만의** 이름을 적는다. 아래 값은 예시이므로 그대로 쓰지 않는다.

```hcl
# terraform.tfvars
bucket_name = "my-terraform-practice-123456789012"
```

---

## 4. 버킷 만들기와 기존 정보 읽기

`main.tf` 아래에 리소스와 data source를 추가한다.

```hcl
resource "aws_s3_bucket" "practice" {
  bucket = var.bucket_name

  tags = {
    Purpose = "terraform-practice"
  }
}

data "aws_caller_identity" "current" {}

output "bucket_name" {
  description = "만든 버킷 이름"
  value       = aws_s3_bucket.practice.bucket
}

output "account_id" {
  description = "실행에 사용한 AWS 계정 ID"
  value       = data.aws_caller_identity.current.account_id
}
```

`aws_s3_bucket.practice`는 앞으로 Terraform이 관리할 버킷이다. `data.aws_caller_identity.current`는 AWS에 이미 있는 계정 정보를 **읽기만** 한다. 두 출력값을 비교하면 어느 계정에 어떤 이름의 버킷을 만들었는지 확인할 수 있다.

---

## 5. 계획을 확인하고 적용하기

먼저 파일 형식과 구성을 검사한 뒤 provider를 내려받는다.

```bash
terraform fmt
terraform init
terraform validate
```

이어서 계획을 확인한다. 처음 실행이라면 버킷 한 개를 추가한다는 내용이 보여야 한다.

```bash
terraform plan
# Plan: 1 to add, 0 to change, 0 to destroy.
```

계정과 버킷 이름이 의도한 값인지 확인한 뒤 적용한다.

```bash
terraform apply
terraform output
```

`apply`는 계획을 다시 보여 주고 승인을 요구한다. 완료되면 `bucket_name`과 `account_id`가 출력된다. AWS CLI가 있다면 실제 버킷도 조회한다.

```bash
aws s3api head-bucket --bucket "$(terraform output -raw bucket_name)"
```

`head-bucket`이 오류 없이 끝나면 버킷에 접근할 수 있다는 뜻이다. 자세한 관리 대상은 `terraform state list`로 본다. data source도 state에서 추적되지만, Terraform이 새로 만든 대상은 버킷 리소스뿐이다.

---

## 6. 변경과 정리

예를 들어 `Purpose` 태그를 `terraform-study`로 바꾸고 `terraform plan`을 실행하면 버킷을 교체하지 않고 태그를 수정하는 계획이 나온다. 반면 버킷 이름처럼 교체가 필요한 속성은 `-/+`로 표시될 수 있다. 실제 적용 전에는 **추가·변경·삭제 수와 교체 표시**를 확인한다.

실습이 끝나면 버킷이 비어 있는 상태에서 삭제한다.

```bash
terraform destroy
```

S3 버킷에 객체가 남아 있으면 삭제가 실패할 수 있다. 실습 중 객체를 올렸다면 먼저 객체를 확인하고 정리해야 한다. `destroy`가 끝나면 `terraform state list`에는 관리 대상 리소스가 남지 않는다.

---

## 7. 정리

로컬 파일과 AWS 버킷은 provider와 리소스 종류만 다르다. Terraform은 코드로 원하는 상태를 적고, `plan`으로 변경을 검토한 뒤 `apply`로 반영한다. `data` 블록은 기존 정보를 읽을 때 사용한다.

실제 인프라에서는 누가 어느 계정에서 실행하는지와 state를 어디에 보관하는지가 중요하다. [다음 글](/posts/Terraform-4-원격-state와-잠금으로-함께-작업하기/)에서는 로컬 state를 원격으로 옮겨 여러 사람이 작업하는 방법을 살펴본다.

참고: [AWS S3 버킷 리소스](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket), [AWS 계정 정보 data source](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/caller_identity)
