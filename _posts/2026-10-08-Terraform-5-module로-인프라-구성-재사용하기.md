---
layout: post
title: "Terraform (5) - module로 인프라 구성 재사용하기"
date: 2026-10-08 19:58:51 +0900
categories: ["Terraform"]
tags: ["terraform", "iac", "module", "hcl"]
---

## 1. 개요

[2편](/posts/Terraform-2-변수-출력-반복으로-여러-리소스-다루기/)에서는 `for_each`로 같은 종류의 파일을 여러 개 만들었다. 그런데 파일 생성과 출력값을 하나의 묶음으로 다른 프로젝트에서도 쓰려면 관련 코드를 함께 복사해야 한다.

**module**은 여러 Terraform 블록을 한 디렉터리에 모아 입력과 출력을 정한 재사용 단위다. 현재 명령을 실행하는 디렉터리는 **root module**, 거기서 불러오는 디렉터리는 **child module**이다. 이번에는 로컬 파일 예제로 module의 연결 방식을 익힌다.

---

## 2. 디렉터리와 입력 정의

새 실습 디렉터리에 다음 파일을 만든다. 각 디렉터리 안의 `.tf` 파일은 하나의 module로 읽힌다.

```text
terraform-module-practice/
├── main.tf
├── outputs.tf
└── modules/
    └── greeting_file/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

child module이 받을 값을 먼저 정의한다.

```hcl
# modules/greeting_file/variables.tf
variable "name" {
  description = "인사받을 사람 이름"
  type        = string
}

variable "output_dir" {
  description = "파일을 저장할 디렉터리"
  type        = string
}
```

입력 변수는 module 바깥에서 값을 전달받는 통로다. module 내부에서 이 값은 `var.name`, `var.output_dir`로 읽는다.

---

## 3. child module 구현

파일 하나를 만드는 리소스를 작성한다. `local_file` provider는 root module에서 설치할 것이다.

```hcl
# modules/greeting_file/main.tf
resource "local_file" "greeting" {
  filename = "${var.output_dir}/${var.name}.txt"
  content  = "Hello, ${var.name}!\n"
}
```

바깥에서 파일 경로를 사용할 수 있도록 출력값을 정의한다.

```hcl
# modules/greeting_file/outputs.tf
output "filename" {
  description = "만든 파일 경로"
  value       = local_file.greeting.filename
}
```

child module의 출력값은 `module.호출이름.출력이름`으로 읽는다. 내부 리소스 주소를 바깥으로 직접 노출하지 않아도 된다.

---

## 4. root module에서 두 번 호출하기

root module의 `main.tf`에 provider 요구 사항과 module 호출을 적는다.

```hcl
# main.tf
terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

module "alice" {
  source     = "./modules/greeting_file"
  name       = "alice"
  output_dir = path.module
}

module "bob" {
  source     = "./modules/greeting_file"
  name       = "bob"
  output_dir = path.module
}
```

`source`가 같은 두 호출은 같은 코드로 **서로 다른 파일**을 만든다. `path.module`을 root에서 전달하므로 결과 파일은 root 디렉터리에 생긴다.

```hcl
# outputs.tf
output "greeting_files" {
  description = "두 module이 만든 파일"
  value = [
    module.alice.filename,
    module.bob.filename,
  ]
}
```

---

## 5. 실행하고 확인하기

새 module을 추가한 뒤에는 `init`을 실행한다. 이어서 형식과 구성을 확인하고 계획을 적용한다.

```bash
terraform init
terraform fmt -recursive
terraform validate
terraform plan
terraform apply
```

계획에는 파일 리소스 두 개가 나타난다. 적용 후 출력과 파일을 확인한다.

```bash
terraform output greeting_files
cat alice.txt bob.txt
terraform state list
```

state의 주소는 `module.alice.local_file.greeting`과 `module.bob.local_file.greeting`처럼 module 경로를 포함한다. 같은 child module 코드를 썼어도 호출마다 별개 리소스로 관리한다. 실습을 마치면 `terraform destroy`로 두 파일을 정리한다.

---

## 6. 언제 module로 나눌까

파일 수를 줄이기 위해 무조건 module을 만들 필요는 없다. 네트워크·서버·보안 설정처럼 **함께 재사용할 리소스**가 있고, 사용하는 쪽에 필요한 입력과 출력을 분명히 정할 수 있을 때 효과적이다. module은 로컬 디렉터리뿐 아니라 Terraform Registry에서도 가져올 수 있다. 외부 module은 사용 전에 내용과 버전을 확인한다.

`for_each`는 같은 리소스를 목록만큼 반복할 때, module은 관련 리소스와 입출력을 하나의 단위로 묶을 때 쓴다. 필요하면 module 호출 자체에 `for_each`를 줄 수도 있다.

---

## 7. 정리

module은 Terraform 구성을 입력 변수와 출력값이 있는 재사용 단위로 만든다. root module에서 `source`로 child module을 불러오고, 입력을 전달하며, `module.이름.출력값`으로 결과를 받는다.

[다음 글](/posts/Terraform-6-기존-리소스-import와-drift-확인하기/)에서는 Terraform 바깥에서 이미 만든 리소스를 관리 대상으로 가져오는 방법을 다룬다.

참고: [Module 구성](https://developer.hashicorp.com/terraform/language/modules/configuration), [로컬 module 학습 과정](https://developer.hashicorp.com/terraform/tutorials/modules)
