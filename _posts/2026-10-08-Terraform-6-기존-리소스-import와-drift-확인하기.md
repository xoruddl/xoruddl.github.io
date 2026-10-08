---
layout: post
title: "Terraform (6) - 기존 리소스 import와 drift 확인하기"
date: 2026-10-08 19:59:13 +0900
categories: ["Terraform"]
tags: ["terraform", "iac", "import", "state"]
---

## 1. 개요

지금까지는 Terraform 코드로 새 리소스를 만들었다. 실제 환경에는 콘솔이나 다른 도구로 이미 만든 리소스도 있다. 이를 Terraform에서 관리하려면 **코드의 리소스 주소와 기존 객체를 연결**해야 한다. 그 과정이 `import`다.

또 Terraform 밖에서 리소스가 바뀌면 코드와 실제 상태가 달라진다. 이런 차이를 **drift**라고 한다. 이 글에서는 S3 버킷을 예로 import하고, 변경 계획을 읽는 방법을 살펴본다.

---

## 2. 실습 전 확인

예제는 [3편](/posts/Terraform-3-AWS-S3-버킷으로-실제-인프라-관리하기/)처럼 AWS 계정과 S3 권한이 필요하다. **이미 존재하지만 이 Terraform 구성에서는 관리하지 않는 빈 버킷** 하나를 대상으로 한다. 버킷 이름은 `my-existing-bucket-123456789012`를 예시로 쓰며, 실제 이름으로 바꿔야 한다.

이미 다른 Terraform state가 관리하는 버킷을 다시 import하지 않는다. 같은 객체를 여러 state가 동시에 관리하면 서로 다른 계획이 충돌할 수 있다. 버킷의 리전과 현재 AWS 계정을 확인하고, 기존 설정을 바꾸거나 삭제할 권한이 있는지 먼저 확인한다.

---

## 3. 코드와 import 블록 작성

새 디렉터리의 `main.tf`에 provider, 리소스 주소, import 블록을 적는다.

```hcl
# main.tf
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "ap-northeast-2"
}

resource "aws_s3_bucket" "existing" {
  bucket = "my-existing-bucket-123456789012"
}

import {
  to = aws_s3_bucket.existing
  id = "my-existing-bucket-123456789012"
}
```

`to`는 Terraform 코드 안의 주소, `id`는 provider가 기존 객체를 찾을 때 쓰는 값이다. S3 버킷의 import ID는 버킷 이름이다. 다른 리소스는 ID 형식이 다를 수 있으므로 해당 리소스의 provider 문서를 확인한다.

---

## 4. 계획을 읽고 가져오기

먼저 형식과 구성을 확인한다.

```bash
terraform fmt
terraform init
terraform validate
terraform plan
```

계획에는 `aws_s3_bucket.existing`을 **import한다는 표시**가 있어야 한다. `1 to add`처럼 새 버킷 생성 계획이 나오면 import 주소와 ID를 다시 확인한다. import와 함께 태그 변경 같은 추가 작업이 계획될 수도 있다. 기존 설정을 유지하려면 적용 전에 코드와 계획을 맞춘다.

계획이 의도한 내용일 때만 적용한다.

```bash
terraform apply
terraform state list
# aws_s3_bucket.existing
```

`import`는 기존 버킷 자체를 새로 만들지 않고 state에 연결한다. import 블록은 이 작업을 기록으로 남기기 위해 코드에 보관할 수 있다. import 후에도 `resource` 블록이 필요하며, 이후 변경은 평소처럼 `plan`과 `apply`로 관리한다.

---

## 5. 코드 밖의 변경 확인하기

예를 들어 AWS 콘솔에서 버킷의 태그를 바꾼 뒤 `terraform plan`을 실행하면, Terraform은 실제 값을 다시 읽고 코드와 비교한다. 코드에 원하는 태그를 적었다면 계획에 이를 되돌리거나 수정하는 내용이 나타난다.

```hcl
resource "aws_s3_bucket" "existing" {
  bucket = "my-existing-bucket-123456789012"

  tags = {
    Purpose = "terraform-practice"
  }
}
```

태그처럼 별도 리소스로 관리되는 설정도 있다. S3 버킷의 버전 관리나 공개 접근 차단을 포함해 **모든 기존 설정이 위 리소스 블록 하나로 관리되는 것은 아니다.** import 직후 `plan` 결과를 꼼꼼히 읽고, 관리할 설정은 각각의 리소스 문서에 맞춰 코드에 추가한다.

drift가 보인다고 바로 `apply`하지 않는다. 콘솔에서 한 변경이 의도한 운영 변경이라면 코드를 그 상태에 맞추고, 실수였다면 계획을 검토한 뒤 Terraform으로 되돌린다. `plan`은 판단 자료이고, 어느 쪽이 맞는지는 운영 의도를 확인해야 한다.

---

## 6. 관리만 중단할 때

기존 버킷을 남겨 두고 Terraform 관리만 중단해야 할 수도 있다. 이때 `terraform destroy`는 버킷 삭제를 계획하므로 쓰지 않는다. 대신 state에서 연결을 제거하는 `removed` 블록 등 공식 절차를 사용하고, 계획이 **객체 삭제 없이 state에서만 제거**하는지 확인한다. [리소스 관리 중단 문서](https://developer.hashicorp.com/terraform/language/state/remove)

---

## 7. 정리

`import`는 기존 인프라를 Terraform의 리소스 주소에 연결한다. `import` 블록과 대응하는 `resource` 블록을 작성하고, `plan`에 예상하지 못한 생성·변경·삭제가 없는지 확인한 뒤 적용한다.

Terraform 밖의 변경은 다음 `plan`에서 확인할 수 있다. 변경을 되돌릴지 코드에 반영할지 결정할 때는 실제 운영 의도를 먼저 확인한다.

참고: [Terraform import 블록](https://developer.hashicorp.com/terraform/language/block/import), [AWS S3 버킷 import](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket)
