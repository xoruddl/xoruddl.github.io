---
layout: post
title: "Terraform (1) - 처음 보는 사람을 위한 HCL 문법 정리"
date: 2026-09-25 12:19:19 +0900
categories: ["Terraform"]
tags: ["terraform", "hcl", "iac"]
---

## 1. 개요

Terraform은 "어떤 인프라가 있어야 하는가"를 코드로 적어 두면, 그 상태가 되도록 API를 호출해 리소스를 만들어 주는 도구다.

이 글은 Terraform 코드를 읽는 데 필요한 문법을 정리한다.

---

## 2. 블록 구조 읽기

Terraform 코드는 **HCL**(HashiCorp Configuration Language)로 쓴다. HCL 파일은 모두 **블록**으로 이루어져 있고, 블록은 다음 모양이다.

```hcl
resource "libvirt_pool" "k8s" {   # 블록 타입, 라벨 1, 라벨 2
  name = "k8s-lab"                # 인자(argument): 이름 = 값
  type = "dir"

  target {                        # 블록 안의 중첩 블록
    path = var.pool_path
  }
}
```

- **블록 타입**(`resource`): 이 블록이 무엇인지 나타낸다.
- **라벨**(`"libvirt_pool"`, `"k8s"`): 블록 타입에 따라 개수가 다르다. `resource`는 "리소스 종류"와 "내가 붙인 이름" 두 개를 받는다.
- **인자**: `이름 = 값` 형태다. `=`가 있으면 인자, 없이 `{`가 바로 오면 중첩 블록이다.

예제 코드에 나온 최상위 블록은 여섯 가지다.

| 블록 | 뜻 | 예 |
| --- | --- | --- |
| `terraform` | Terraform 자체 설정. 필요한 provider와 버전 | `versions.tf` |
| `provider` | provider(API 플러그인)의 접속 설정 | `provider "libvirt" { uri = "qemu:///system" }` |
| `resource` | 만들고 관리할 대상. 핵심 블록이다 | `resource "libvirt_domain" "node"` |
| `variable` | 밖에서 받는 입력값 | `variable "worker_ids"` |
| `locals` | 코드 안에서 계산해 두는 중간값 | `locals { nodes = ... }` |
| `output` | apply 뒤 화면에 보여 줄 값 | `output "nodes"` |

`resource` 블록의 두 라벨과 `name` 인자는 쓰임이 다르다.

| 표기 | 뜻 | 정하는 방법 |
| --- | --- | --- |
| `"libvirt_pool"` | 리소스 종류. 앞의 `libvirt_`는 libvirt provider의 리소스라는 뜻 | provider가 정해 둔 이름 중에서 고른다 |
| `"k8s"` | Terraform 코드 안에서 이 리소스를 부르는 이름. `libvirt_pool.k8s`로 참조한다 | 자유롭게 짓는다. 종류가 다르면 같은 이름도 된다 (`libvirt_network.k8s`) |
| `name = "k8s-lab"` | libvirt에 실제로 만들어지는 풀 이름. `virsh pool-list`에 보인다 | 리소스 종류마다 정해진 인자 |

라벨 `k8s`를 `main`으로 바꿔도 실제 풀 이름은 `k8s-lab` 그대로다. 다만 Terraform은 라벨이 바뀌면 다른 리소스로 보므로, plan에 "기존 것 삭제, 새로 생성"이 나온다.

Terraform은 한 디렉터리의 `.tf` 파일을 모두 합쳐 하나로 읽는다. `main.tf`, `variables.tf`처럼 나눈 것은 사람이 보기 편하게 하려는 관례일 뿐이다. `#`로 시작하는 줄은 주석이다.

---

## 3. 값과 타입

인자의 값에는 타입이 있다. `variables.tf`의 `type =`에 쓰인 타입을 정리하면 다음과 같다.

| 타입 | 모양 | 예 |
| --- | --- | --- |
| `string` | `"..."` | `network_cidr = "10.10.10.0/24"` |
| `number` | `2`, `4096` | `nfs_data_disk_gb = 50` |
| `bool` | `true`, `false` | `autostart = true` |
| `list(string)` | `["a", "b"]` (순서 있음, 중복 가능) | `ssh_public_keys` |
| `set(number)` | `[1, 2]` (순서 없음, 중복 없음) | `worker_ids` |
| `map` | `{ "cp-1" = "10.10.10.10" }` (키로 찾음) | `output "nodes"`의 값 |
| `object({...})` | 필드 이름과 타입이 정해진 map | `control_plane`, `worker` |

`object` 타입은 "이런 필드를 가진 값만 받겠다"는 선언이다.

```hcl
variable "worker" {
  type = object({
    vcpu      = number
    memory_mb = number
    disk_gb   = number
  })
  default = { vcpu = 4, memory_mb = 6144, disk_gb = 80 }
}
```

`worker_ids`를 `list`가 아니라 `set`으로 둔 이유는 6장의 `for_each`가 set이나 map만 받기 때문이다. `default = [1, 2]`처럼 대괄호로 적어도 `type`이 `set(number)`이면 set으로 바뀐다.

변수 값은 우선 `default`가 쓰이고, `terraform.tfvars`에 적은 값이 그것을 덮어쓴다. 실행할 때 `-var "worker_ids=[1,2,3]"`로 주면 그 값이 가장 우선한다.

---

## 4. 다른 값 참조하기

다른 곳에 정의한 값은 정해진 접두사로 부른다.

| 표현 | 뜻 | 예 |
| --- | --- | --- |
| `var.이름` | `variable` 블록의 값 | `var.network_cidr` |
| `local.이름` | `locals` 블록의 값 | `local.nodes` |
| `리소스종류.이름.속성` | 다른 리소스의 속성 | `libvirt_pool.k8s.name`, `libvirt_volume.base.id` |
| `path.module` | 지금 `.tf` 파일이 있는 디렉터리 | `"${path.module}/templates/..."` |

`locals`는 블록 이름이 복수형(`locals`)이지만 참조할 때는 단수형(`local.`)이라는 점이 헷갈리기 쉽다.

리소스 참조는 값을 가져오는 동시에 **만드는 순서**도 정한다.

```hcl
resource "libvirt_volume" "disk" {
  pool           = libvirt_pool.k8s.name      # 풀이 먼저 있어야 함
  base_volume_id = libvirt_volume.base.id     # base 이미지가 먼저 있어야 함
  # ...
}
```

이 디스크를 만들려면 base 이미지의 `id`를 알아야 한다. 그런데 `id`는 코드에 적는 값이 아니라, libvirt가 base 이미지를 **실제로 만든 뒤에** 돌려주는 값이다. 그래서 Terraform은 다음처럼 판단한다.

1. `disk`가 `libvirt_volume.base.id`를 쓴다.
2. 그 값은 base 이미지가 만들어져야 나온다.
3. 그러니 base 이미지를 먼저 만들고, 끝나면 `disk`를 만든다.

예제의 리소스들은 모두 이렇게 서로를 참조하고 있어서, 참조를 따라가면 만드는 순서가 정해진다.

```text
libvirt_pool.k8s            아무것도 참조하지 않음 → 가장 먼저
   ↓  pool = libvirt_pool.k8s.name
libvirt_volume.base
   ↓  base_volume_id = libvirt_volume.base.id
libvirt_volume.disk
   ↓  volume_id = libvirt_volume.disk[each.key].id
libvirt_domain.node         VM → 마지막
```

일반 스크립트는 위에서 아래로 적힌 순서대로 실행되지만, Terraform은 그렇지 않다. `main.tf`에서 VM 블록을 맨 위에, 풀 블록을 맨 아래에 적어도 위 참조 관계에 따라 풀부터 만든다. **값을 참조하는 것 자체가 순서 지정**이므로, "이것 다음에 저것" 같은 순서를 따로 적지 않아도 된다. 지울 때는 반대로 VM부터 지우고 풀을 마지막에 지운다.

---

## 5. 문자열 보간과 함수

문자열 안에 `${ }`를 쓰면 그 자리에 값이 들어간다. 이것을 **보간**(interpolation)이라고 한다.

```hcl
name = "${each.key}.qcow2"     # each.key가 "worker-1"이면 "worker-1.qcow2"
```

Terraform에는 사용자 정의 함수가 없고, 내장 함수만 쓸 수 있다.

| 함수 | 하는 일 | 예와 결과 |
| --- | --- | --- |
| `cidrhost(대역, n)` | 대역의 n번째 IP | `cidrhost("10.10.10.0/24", 21)` → `"10.10.10.21"` |
| `split(구분자, 문자열)` | 문자열을 나눠 list로 | `split("/", "10.10.10.0/24")[1]` → `"24"` |
| `merge(map, map, ...)` | 여러 map을 하나로. 키가 겹치면 뒤쪽 값 | `merge(var.worker, { ip = "..." })` |
| `length(값)` | 원소 개수 | `length(var.worker_ids)` → `2` |
| `alltrue(list)` | 모두 `true`인지 | 변수 검증에 사용 |
| `floor(수)` | 소수점 버림 | `floor(n) == n`이면 정수 |
| `templatefile(경로, 변수 map)` | 템플릿 파일을 읽고 값을 채워 문자열로 | cloud-init, inventory 생성 |
| `yamlencode(값)` | 값을 YAML 문자열로 | cloud-init의 `meta_data` |

`merge`는 노드 사양에 IP와 역할을 덧붙일 때 쓰였다.

```hcl
merge(var.worker, { ip = "10.10.10.21", role = "workers" })
# → { vcpu = 4, memory_mb = 6144, disk_gb = 80, ip = "10.10.10.21", role = "workers" }
```

함수 결과가 헷갈리면 `terraform console`로 직접 계산해 볼 수 있다. `.tf` 파일이 있는 디렉터리에서 실행하면 `var.`, `local.` 값도 쓸 수 있다.

```bash
terraform console
> cidrhost("10.10.10.0/24", 21)
"10.10.10.21"
> local.nodes["worker-1"].ip
"10.10.10.21"
```

---

## 6. 반복 만들기 (for_each)

같은 종류의 리소스를 여러 개 만들 때 `for_each`를 쓴다. `for_each`에 map(또는 set)을 주면 원소마다 리소스가 하나씩 생긴다.

```hcl
resource "libvirt_volume" "disk" {
  for_each = local.nodes          # { "cp-1" = {...}, "worker-1" = {...}, ... }

  name = "${each.key}.qcow2"      # 키: "cp-1", "worker-1", ...
  size = each.value.disk_gb * 1024 * 1024 * 1024   # 값: 그 노드의 사양 object
}
```

- `each.key`: 지금 만드는 원소의 키. 여기서는 노드 이름이다.
- `each.value`: 그 키의 값. 여기서는 `{ vcpu, memory_mb, disk_gb, ip, role }` object다.

`for_each`로 만든 리소스는 키로 하나씩 가리킨다. 그래서 VM 정의에서 "같은 이름의 디스크"를 이렇게 연결한다.

```hcl
resource "libvirt_domain" "node" {
  for_each = local.nodes
  # ...
  disk {
    volume_id = libvirt_volume.disk[each.key].id   # worker-1 VM ← worker-1 디스크
  }
}
```

`terraform plan` 출력에 나오는 `libvirt_volume.disk["worker-1"]`도 같은 주소 표기다.

비슷한 기능으로 `count = 3`이 있다. `count`는 리소스를 `[0]`, `[1]`, `[2]` 번호로 구분한다. 중간 것을 빼면 뒤 번호가 당겨지면서 관계없는 VM까지 다시 만들어질 수 있다. 예제 코드에서 `count` 대신 `for_each`와 이름 키를 쓴 이유다.

---

## 7. for 표현식과 조건식

### 7.1 for 표현식

`for` 표현식은 기존 컬렉션을 변환해 새 list나 map을 만든다. 괄호 모양이 결과 타입을 정한다.

```hcl
# [ ] → list를 만든다
[for n in var.worker_ids : n >= 1 && n <= 9]
# worker_ids가 [1, 2]면 → [true, true]

# { } 와 => → map을 만든다
{ for n in var.worker_ids : "worker-${n}" => cidrhost(var.network_cidr, 20 + n) }
# → { "worker-1" = "10.10.10.21", "worker-2" = "10.10.10.22" }
```

map을 순회할 때는 `k, v`처럼 변수를 두 개 받아 키와 값을 함께 쓴다. 끝에 `if`를 붙이면 조건에 맞는 원소만 남는다.

```hcl
workers = { for k, v in local.nodes : k => v.ip if v.role == "workers" }
# local.nodes에서 role이 workers인 것만 골라 "이름 => IP" map으로
# → { "worker-1" = "10.10.10.21", "worker-2" = "10.10.10.22" }
```

예제의 `local_file.inventory`는 이 방식으로 역할별 노드 목록을 만들어 inventory 템플릿에 넘긴다.

### 7.2 조건식

`조건 ? 참일 때 값 : 거짓일 때 값` 형태다. NFS 서버 VM에만 데이터 디스크를 붙일 때 쓰였다.

```hcl
each.value.role == "nfs" ? [libvirt_volume.nfs_data.id] : []
# nfs-1이면 원소 1개짜리 list, 나머지 노드는 빈 list
```

### 7.3 dynamic 블록

중첩 블록(`disk { }`)은 인자가 아니라서 `count`나 조건식을 직접 쓸 수 없다. 블록을 조건에 따라 0개 또는 여러 개 만들고 싶을 때 `dynamic`을 쓴다.

```hcl
dynamic "disk" {                   # 만들 블록 이름
  for_each = each.value.role == "nfs" ? [libvirt_volume.nfs_data.id] : []
  content {                        # 만들어질 블록의 내용
    volume_id = disk.value         # 반복 변수 이름은 블록 이름(disk)과 같다
  }
}
```

`for_each`의 list 원소 수만큼 `disk { volume_id = ... }` 블록이 생긴다. 빈 list면 아무것도 생기지 않는다. `dynamic` 안의 반복 변수는 `each`가 아니라 **블록 이름**(`disk.value`)이라는 점에 주의한다.

---

## 8. validation과 lifecycle

### 8.1 validation

`variable` 안의 `validation` 블록은 잘못된 입력을 plan 단계에서 막는다. `condition`이 `false`면 `error_message`를 보여 주고 멈춘다.

```hcl
validation {
  condition     = length(var.worker_ids) >= 1 && length(var.worker_ids) <= 3
  error_message = "worker는 1~3대만 허용됩니다 (home1 메모리 예산 제한)."
}
```

`&&`는 "그리고", `||`는 "또는", `!`는 "아니다"를 뜻한다.

### 8.2 lifecycle

`lifecycle`은 모든 리소스에 쓸 수 있는 특별한 블록으로, Terraform이 리소스를 바꾸거나 지우는 방식을 조정한다.

| 설정 | 뜻 | 예제에서 쓴 이유 |
| --- | --- | --- |
| `ignore_changes = [size]` | 코드에서 `size`가 바뀌어도 기존 리소스는 그대로 둠 | 크기 변경을 "디스크 재생성"으로 처리하는 provider 동작 회피 |
| `prevent_destroy = true` | 이 리소스를 지우려는 plan이면 오류로 멈춤 | NFS 데이터 디스크를 실수로 지우지 않게 |

---

## 9. 템플릿 파일(.tftpl)

`templatefile()`이 읽는 `.tftpl` 파일에는 두 가지 문법이 있다.

| 문법 | 뜻 |
| --- | --- |
| `${ 값 }` | 값을 그 자리에 넣는다 |
| `%{ for ... } ... %{ endfor }` | 반복한다. `%{ if } ... %{ endif }`도 있다 |

inventory 템플릿을 예로 든다. `main.tf`가 `workers = { "worker-1" = "10.10.10.21", ... }`를 넘긴다.

```text
[workers]
%{ for name, ip in workers ~}
${name} ansible_host=${ip}
%{ endfor ~}
```

결과는 다음과 같다.

```ini
[workers]
worker-1 ansible_host=10.10.10.21
worker-2 ansible_host=10.10.10.22
```

`~`는 **공백 제거** 표시다. `~}`는 태그 뒤의 공백과 줄바꿈을 지운다. `~`가 없으면 `%{ for }`와 `%{ endfor }` 태그가 있던 줄이 빈 줄로 남아 결과 파일에 빈 줄이 끼어든다.

---

## 10. 명령과 plan 읽기

| 명령 | 하는 일 |
| --- | --- |
| `terraform init` | provider를 내려받는다. 처음 한 번, provider를 바꿨을 때 다시 |
| `terraform fmt` | 코드 들여쓰기와 `=` 정렬을 표준 형식으로 맞춘다 |
| `terraform validate` | 문법과 타입 오류를 확인한다 |
| `terraform plan` | 코드와 현재 상태를 비교해 할 일을 보여 준다. 실제로 바꾸지 않는다 |
| `terraform apply` | plan 내용을 보여 주고, `yes`를 입력하면 실행한다 |
| `terraform output` | `output` 값을 다시 출력한다 |
| `terraform state list` | Terraform이 관리 중인 리소스 목록 |

Terraform은 자기가 만든 리소스를 `terraform.tfstate` 파일(**state**)에 기록한다. plan은 "코드", "state", "실제 인프라"를 비교해서 차이만 실행한다. 그래서 같은 코드로 apply를 여러 번 해도 결과가 같다.

plan 출력의 기호는 꼭 구분해서 읽어야 한다.

| 기호 | 뜻 | 위험도 |
| --- | --- | --- |
| `+` (`will be created`) | 새로 만든다 | 낮음 |
| `~` (`will be updated in-place`) | 지우지 않고 속성만 바꾼다 | 보통 |
| `-/+` (`must be replaced`) | 지우고 새로 만든다 | 높음. 데이터가 사라질 수 있음 |
| `-` (`will be destroyed`) | 지운다 | 높음 |

`# forces replacement`가 붙은 속성이 있으면 그 속성 때문에 리소스가 교체된다는 뜻이다. IaC 시리즈 2편에서 디스크 크기를 바꿨을 때가 이 경우였다. apply 전에 `-/+`와 `-`가 의도한 리소스에만 있는지 확인하는 습관을 들인다.

---

## 11. 정리

Terraform 코드는 블록과 `이름 = 값` 인자로 이루어져 있다. `var.`, `local.`, `리소스종류.이름.속성`으로 값을 참조하고, 이 참조가 곧 리소스를 만드는 순서가 된다.

여러 개를 만들 때는 `for_each`와 `each.key`/`each.value`를 쓰고, 컬렉션을 변환할 때는 `for` 표현식, 블록을 조건부로 만들 때는 `dynamic`을 쓴다. `validation`은 잘못된 입력을, `lifecycle`은 위험한 교체와 삭제를 막는다.

모르는 표현이 나오면 `terraform console`로 값을 직접 계산해 보고, apply 전에는 plan의 `-/+`와 `-`를 반드시 확인한다.
