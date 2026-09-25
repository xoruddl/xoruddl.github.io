---
layout: post
title: "IaC (1) - 홈서버 가상화 구성과 Terraform·Ansible 역할 나누기"
date: 2026-09-24 15:56:34 +0900
categories: ["IaC"]
tags: ["terraform", "ansible", "libvirt", "kvm", "kubeadm", "홈서버"]
---

## 1. 개요

홈서버 한 대(Ubuntu 24.04, 12스레드, 32GB RAM) 위에 가상 머신(VM) 3대를 만들고, 그 VM들로 kubeadm 쿠버네티스 클러스터를 구성한다. 손으로 VM을 만들고 노드마다 SSH로 들어가 명령을 입력해도 되지만, 그렇게 하면 같은 환경을 다시 만들거나 노드를 늘리기가 번거롭다.

이 시리즈에서는 작업을 두 도구로 나눈다. **Terraform**은 "VM이 몇 대, 어떤 사양으로 있어야 하는가"를 코드로 선언하고, **Ansible**은 "만들어진 VM 안에서 무엇을 설치하고 실행할 것인가"를 코드로 자동화한다.

---

## 2. VM을 만드는 계층

홈서버에서 VM을 만들 때는 여러 계층이 함께 동작한다. 아래쪽부터 역할을 정리하면 다음과 같다.

```text
┌─────────────────────────────────────┐
│ Terraform   "VM 3대가 있어야 한다"      │  원하는 상태를 코드로 선언
└──────────────┬──────────────────────┘
               │ libvirt provider (플러그인)
┌──────────────▼──────────────────────┐
│ libvirt     VM 관리 API / 데몬        │  VM 생성·시작·삭제, 가상 네트워크, 스토리지
└──────────────┬──────────────────────┘
┌──────────────▼──────────────────────┐
│ QEMU        VM 프로세스 실행           │  가상 디스크·NIC 같은 하드웨어 에뮬레이션
├─────────────────────────────────────┤
│ KVM         리눅스 커널 모듈            │  CPU 가상화 가속 (/dev/kvm)
└─────────────────────────────────────┘
```

| 구성 요소 | 역할 |
| --- | --- |
| KVM | CPU의 가상화 기능(VT-x, AMD-V)을 이용해 VM을 빠르게 실행한다. |
| QEMU | VM 하나를 프로세스 하나로 실행하고 가상 하드웨어를 제공한다. |
| libvirt | QEMU/KVM을 API로 관리한다. `virsh`가 대표적인 CLI다. |
| Terraform | libvirt API를 호출해 코드에 선언한 VM을 만든다. |

클라우드와 비교하면 이해가 쉽다. AWS에서 Terraform이 AWS API를 호출해 EC2를 만드는 것처럼, 홈서버에서는 Terraform이 **libvirt API**를 호출해 QEMU/KVM VM을 만든다. libvirt가 홈서버를 작은 클라우드처럼 만들어 주는 셈이다.

---

## 3. Terraform과 Ansible의 역할 분담

| 단계 | 담당 | 하는 일 |
| --- | --- | --- |
| 인프라 | Terraform | 네트워크, 디스크, VM 생성, cloud-init으로 계정·SSH 키·고정 IP 주입 |
| 연결 | Terraform → Ansible | VM IP 목록으로 Ansible inventory 파일 자동 생성 |
| 설정 | Ansible | containerd·kubeadm 설치, `kubeadm init`, CNI 설치, worker `join` |

kubeadm은 각 노드에서 직접 실행하는 CLI라서 Ansible이 꼭 필요한 것은 아니다. 하지만 컨트롤 플레인에서 `kubeadm init`이 끝나야 join 토큰이 생기고, 그 토큰을 worker에 넘겨야 하는 **순서 의존성**이 있다. VM 부팅 스크립트(cloud-init)만으로는 이 순서를 맞추기 어렵고, Ansible은 이런 흐름을 제어하기에 알맞다.

참고로 Kubespray는 이 과정을 거대한 Ansible playbook으로 미리 만들어 둔 프로젝트다. 결과는 빨리 얻을 수 있지만, 각 단계를 이해하려는 목적이라면 playbook을 직접 작성해 보는 편이 낫다.

---

## 4. 노드와 네트워크 구성

```text
홈서버
 └─ 10.10.10.0/24 (libvirt NAT 네트워크)
      ├─ cp-1      10.10.10.10   2 vCPU / 4GB / 디스크 50GB
      ├─ worker-1  10.10.10.21   4 vCPU / 6GB / 디스크 80GB
      └─ worker-2  10.10.10.22   4 vCPU / 6GB / 디스크 80GB

Pod CIDR: 10.244.0.0/16 · Service CIDR: 10.96.0.0/12
```

worker는 2대로 시작해 최대 3대까지 늘릴 수 있게 설계한다. 메모리와 디스크 예산도 3대 기준으로 잡았다.

| 항목 | 메모리 | 디스크 |
| --- | --- | --- |
| cp-1 | 4GB | 50GB |
| worker 3대 (최대) | 18GB | 240GB |
| VM 합계 | 22GB | 290GB |
| 호스트 남는 몫 (32GB RAM, 여유 디스크 약 380GB 기준) | 약 9GB | 약 90GB |

vCPU는 물리 스레드를 나눠 쓰는 방식이라, 12스레드 중 10~14개를 할당해도 평소에는 문제가 없다.

디스크도 비슷하다. VM 디스크는 실제로 쓴 만큼만 공간을 차지하므로, 막 만든 직후에는 세 대를 합쳐도 10GB 남짓이다. 위 표의 290GB는 모든 디스크가 가득 차는 최악의 경우다. 이때도 호스트에 여유가 남도록 크기를 정했다.

IP 대역은 서로 겹치지 않게 정했다. 특히 Calico의 기본 Pod CIDR인 `192.168.0.0/16`은 집 LAN(`192.168.x.x`)과 겹칠 수 있어서 `10.244.0.0/16`으로 바꿨다.

---

## 5. 홈서버 준비하기

먼저 CPU 가상화를 쓸 수 있는지 확인한다. `vmx`(Intel) 또는 `svm`(AMD)이 1 이상이고 `/dev/kvm`이 있으면 KVM을 쓸 수 있다.

```bash
egrep -c "(vmx|svm)" /proc/cpuinfo
ls /dev/kvm
```

다음 스크립트로 libvirt, Terraform, Ansible을 한 번에 설치한다. Terraform과 Ansible은 홈서버에서 실행하기로 했다. libvirt 소켓(`qemu:///system`)에 로컬로 붙을 수 있고, NAT 뒤에 있는 VM에도 바로 SSH할 수 있기 때문이다.

```bash
#!/usr/bin/env bash
set -euo pipefail
TARGET_USER="${SUDO_USER:-taekyung}"

# 1. QEMU/KVM + libvirt
apt-get update
apt-get install -y --no-install-recommends \
  qemu-kvm qemu-utils libvirt-daemon-system libvirt-clients \
  virtinst cloud-image-utils genisoimage dnsmasq-base

# 2. sudo 없이 VM을 관리할 수 있도록 그룹 추가
usermod -aG libvirt,kvm "${TARGET_USER}"
systemctl enable --now libvirtd

# 3. Terraform (HashiCorp 공식 apt 저장소)
curl -fsSL https://apt.releases.hashicorp.com/gpg \
  | gpg --dearmor --yes -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
  > /etc/apt/sources.list.d/hashicorp.list
apt-get update && apt-get install -y terraform

# 4. Ansible
apt-get install -y ansible
```

`--no-install-recommends`로 설치하면 SPICE 그래픽 모듈 같은 권장 패키지가 빠진다. 이 때문에 VM 그래픽 설정을 따로 지정해야 한다.

스크립트를 `sudo`로 실행한 뒤 SSH에 다시 접속하면 그룹 변경이 적용된다. 다음 명령으로 설치 결과를 확인한다.

```bash
id                                      # libvirt, kvm 그룹 포함 여부
virsh -c qemu:///system list --all      # sudo 없이 동작해야 한다
terraform version
ansible --version
```

마지막으로 Ansible이 VM에 접속할 때 쓸 SSH 키를 홈서버에 만든다. 이 공개키는 2편에서 cloud-init으로 VM에 넣는다.

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
```

---

## 6. 프로젝트 구조

시리즈 전체에서 사용할 디렉터리 구조는 다음과 같다.

```text
k8s-lab/
├── terraform/
│   ├── versions.tf
│   ├── variables.tf
│   ├── main.tf
│   ├── outputs.tf
│   ├── terraform.tfvars
│   └── templates/
│       ├── user-data.yaml.tftpl
│       ├── network-config.yaml.tftpl
│       └── inventory.ini.tftpl
└── ansible/
    ├── ansible.cfg
    ├── inventory.ini                  ← terraform apply가 자동 생성
    ├── group_vars/all.yml
    ├── site.yml
    ├── remove-worker.yml
    ├── handlers/main.yml
    ├── tasks/
    │   ├── common.yml
    │   └── nfs-server.yml
    └── templates/
        ├── calico-installation.yaml.j2
        └── nfs-storageclass.yaml.j2
```

각 파일이 하는 일과, 전체 코드를 볼 수 있는 글은 다음과 같다.

| 파일 | 하는 일 | 전체 코드 |
| --- | --- | --- |
| `terraform/versions.tf` | Terraform과 provider 버전 고정, libvirt 접속 주소 지정 | 2편 |
| `terraform/variables.tf` | worker 번호 목록, 노드 사양, 네트워크 대역 같은 입력값 정의 | 2편 (5편에서 NFS 추가) |
| `terraform/main.tf` | 네트워크, 디스크, cloud-init, VM, inventory 파일 생성 | 2편 (5편에서 NFS 추가) |
| `terraform/outputs.tf` | apply 후 노드 이름과 IP 출력 | 2편 |
| `terraform/terraform.tfvars` | 실제로 쓸 값(worker 번호, SSH 공개키) 지정 | 2편 |
| `terraform/templates/user-data.yaml.tftpl` | VM 첫 부팅 때 계정·SSH 키 설정 | 2편 |
| `terraform/templates/network-config.yaml.tftpl` | VM 고정 IP 설정 | 2편 |
| `terraform/templates/inventory.ini.tftpl` | Ansible inventory 파일의 형식 | 2편 (5편에서 NFS 추가) |
| `ansible/ansible.cfg` | inventory 위치, 접속 계정, SSH 옵션 | 3편 |
| `ansible/group_vars/all.yml` | 버전, 네트워크 대역 같은 공통 변수 | 3편 (5편에서 NFS 추가) |
| `ansible/site.yml` | 클러스터 구축 전체 흐름 (worker 추가에도 사용) | 3편 (5편에서 NFS 추가) |
| `ansible/tasks/common.yml` | 모든 노드 공통 준비 (swap, 커널, containerd, kubeadm) | 3편 (5편에서 수정) |
| `ansible/handlers/main.yml` | 설정이 바뀌었을 때만 서비스 재시작 | 3편 |
| `ansible/templates/calico-installation.yaml.j2` | Calico Pod 네트워크 설정 | 3편 |
| `ansible/remove-worker.yml` | worker를 클러스터에서 안전하게 빼기 | 4편 |
| `ansible/tasks/nfs-server.yml` | NFS 서버 구성 | 5편 |
| `ansible/templates/nfs-storageclass.yaml.j2` | NFS 기본 StorageClass | 5편 |

---

## 7. 정리

홈서버의 가상화는 KVM(CPU 가속), QEMU(VM 실행), libvirt(관리 API)가 층을 이루고, Terraform은 맨 위에서 libvirt API를 호출해 VM을 만든다. 구조는 클라우드에서 Terraform을 쓰는 것과 같고, API 대상만 AWS 대신 libvirt다.

Terraform은 "무엇이 있어야 하는가"를 선언하고, Ansible은 "그 안에서 무엇을 할 것인가"를 순서대로 실행한다. 두 도구는 Terraform이 만든 inventory 파일로 이어진다.
