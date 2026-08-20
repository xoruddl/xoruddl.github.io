---
layout: post
title: "리눅스 (4-1) - VS Code Remote-SSH Permission denied (publickey) 해결 과정"
date: 2026-08-20 17:15:31 +0900
categories: ["리눅스"]
tags: ["리눅스", "SSH", "VS Code", "Remote-SSH"]
---

VS Code에서 Remote-SSH로 Ubuntu 서버에 접속하려고 했지만 `Permission denied (publickey)` 오류가 발생했다. SSH 키의 passphrase 입력창까지 나타났기 때문에 키 파일 자체는 인식되는 것처럼 보였지만, 실제로는 설정된 개인키와 서버에 등록된 공개키가 서로 맞는지, 그리고 접속 계정이 올바른지를 확인해야 했다.

이번 글에서는 SSH 설정을 확인하고, 터미널에서 디버깅한 뒤, 여러 키가 섞여 있을 때 올바른 키를 구분하는 과정을 정리한다.

---

## 1. 문제 상황

VS Code에서 SSH 접속을 시도하자 다음 오류가 발생했다.

```text
Could not establish connection:
Permission denied (publickey)
```

처음에는 다음과 같은 passphrase 입력창이 나타났다.

```text
Enter passphrase for ssh key
```

여기서 요구하는 값은 서버 로그인 비밀번호가 아니다. 로컬에 저장된 개인키를 암호화할 때 설정한 passphrase다. 개인키에 passphrase가 설정되어 있다면 키를 사용하기 전에 이 값을 입력해야 한다.

다만 passphrase를 정상적으로 입력했는데도 `Permission denied (publickey)`가 발생한다면, 서버가 해당 개인키에 대응하는 공개키를 승인하지 않았을 가능성을 확인해야 한다.

---

## 2. SSH 설정 확인

먼저 로컬의 `~/.ssh/config`에 접속 정보를 등록했다.

```sshconfig
Host ubuntu_server
    HostName 192.168.64.16
    User etakyung
    IdentityFile /Users/itaekyung/.ssh/id_rsa
    IdentitiesOnly yes
```

각 항목의 의미는 다음과 같다.

| 항목 | 의미 |
| --- | --- |
| `Host` | SSH 접속에 사용할 별칭 |
| `HostName` | 실제 서버 주소 또는 호스트명 |
| `User` | 서버에 로그인할 사용자명 |
| `IdentityFile` | 사용할 로컬 개인키 경로 |
| `IdentitiesOnly yes` | 지정한 키만 인증에 사용 |

키 경로에 공백이나 한글이 포함되어 있다면 큰따옴표로 감싸는 것이 안전하다.

```sshconfig
IdentityFile "/Users/itaekyung/Desktop/aws 키페어/leetk.pem"
```

`Host`는 접속 별칭일 뿐이므로, 실제 서버 주소는 `HostName`, 서버 계정은 `User`에 정확히 작성해야 한다.

---

## 3. 터미널에서 먼저 SSH 접속 테스트

VS Code의 오류 메시지만으로는 어떤 키를 실제로 사용했는지 알기 어렵다. 따라서 VS Code보다 먼저 터미널에서 같은 별칭으로 접속을 테스트했다.

```bash
ssh -vvv ubuntu_server
```

`-vvv` 옵션은 SSH 연결 과정을 매우 상세하게 출력한다. 로그에서는 다음과 같은 정보를 확인할 수 있다.

```text
Reading configuration data /Users/itaekyung/.ssh/config
Connecting to 192.168.64.16 port 22
Authenticating ... as 'etakyung'
Trying private key: ...
Permission denied (publickey)
```

특히 다음 메시지가 출력되었다.

```text
signing using rsa-sha2-512
```

이 메시지는 SSH 클라이언트가 RSA 개인키를 사용해 인증 서명을 시도했다는 뜻이다. 즉, 개인키 파일을 읽고 서명하는 단계까지는 진행되었지만, 최종적으로 서버가 그 키를 허용하지 않았다고 해석할 수 있다.

---

## 4. 여러 SSH 키 구분하기

로컬에 다음과 같은 키가 여러 개 존재했다.

```text
~/.ssh/id_ed25519
~/.ssh/id_rsa
~/Desktop/aws 키페어/leetk.pem
```

파일 이름만 보고 현재 접속에 사용되는 키를 판단하면 안 된다. `~/.ssh/config`의 `IdentityFile`에 지정된 키가 무엇인지 확인해야 하며, `IdentitiesOnly yes`가 설정되어 있다면 지정된 키만 인증에 사용된다.

SSH가 별칭에 대해 최종적으로 적용하는 설정은 다음 명령으로 확인할 수 있다.

```bash
ssh -G ubuntu_server | grep -E 'user |hostname |identityfile|identitiesonly'
```

출력에서 `user`, `hostname`, `identityfile`, `identitiesonly` 값을 확인하면 실제 접속 대상과 사용 키를 한 번에 검증할 수 있다.

개인키 파일의 존재 여부와 권한도 확인한다.

```bash
ls -l ~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa
```

개인키의 권한이 지나치게 열려 있으면 SSH가 보안상의 이유로 키 사용을 거부할 수 있다. 일반적으로 개인키는 소유자만 읽고 쓸 수 있도록 `600` 권한을 설정한다.

---

## 5. 공개키 지문 비교

개인키에 대응하는 공개키를 출력한 뒤 지문을 확인하면, 서로 다른 키를 잘못 사용하고 있는지 비교할 수 있다.

```bash
ssh-keygen -y -f ~/.ssh/id_rsa | ssh-keygen -lf -
```

`.pem` 형식의 키도 같은 방식으로 확인할 수 있다.

```bash
ssh-keygen -y -f "/path/to/leetk.pem" | ssh-keygen -lf -
```

이 결과를 서버의 `authorized_keys`에 등록된 공개키 또는 알고 있는 키 지문과 비교한다. 지문이 다르면 해당 개인키는 서버에 등록된 공개키와 한 쌍이 아니다.

---

## 6. 서버의 authorized_keys와 사용자명 확인

서버에서는 로그인하려는 사용자 계정의 `authorized_keys` 파일에 대응하는 공개키가 등록되어 있어야 한다.

```text
/home/etakyung/.ssh/authorized_keys
```

여기서 중요한 점은 사용자별로 `authorized_keys` 파일이 다르다는 것이다. `etakyung` 계정으로 접속한다면 `/home/etakyung/.ssh/authorized_keys`를 확인해야 하며, `ubuntu` 계정으로 접속한다면 `/home/ubuntu/.ssh/authorized_keys`를 확인해야 한다.

Ubuntu 서버의 기본 계정명이 항상 같은 것은 아니므로, 실제 계정명을 바꿔가며 테스트할 수 있다.

```bash
ssh -i ~/.ssh/id_rsa ubuntu@192.168.64.16
```

이 명령이 성공하고 `etakyung@192.168.64.16`으로 접속할 때 실패한다면, 키보다는 `User` 설정이나 해당 사용자의 `authorized_keys` 등록 상태를 먼저 의심할 수 있다.

---

## 7. 원인 정리

이번 오류의 원인은 다음 항목 중 하나일 수 있다.

| 원인 | 확인할 내용 |
| --- | --- |
| 잘못된 개인키 | `IdentityFile` 경로와 `ssh -G` 출력 비교 |
| 공개키 미등록 | 서버 사용자 계정의 `authorized_keys` 확인 |
| 잘못된 사용자명 | `User` 값을 실제 서버 계정과 비교 |
| passphrase 오류 | 개인키 생성 당시 설정한 passphrase인지 확인 |
| 개인키 권한 문제 | 개인키 권한을 `600`으로 설정 |

`Permission denied (publickey)`는 비밀번호 인증이 실패했다는 의미가 아니라, 공개키 인증 방식으로 서버에 로그인하지 못했다는 의미다. 따라서 서버 비밀번호를 반복해서 입력하기보다는, 어떤 개인키를 사용했는지와 그 키의 공개키가 올바른 사용자 계정에 등록되어 있는지를 확인해야 한다.

---

## 8. 정리

VS Code Remote-SSH에서 `Permission denied (publickey)`가 발생하면 먼저 터미널에서 `ssh -vvv`로 접속을 재현하는 것이 좋다. 상세 로그를 통해 실제 서버 주소, 사용자명, 사용된 개인키, 인증 실패 지점을 확인할 수 있다.

확인은 `Host`와 `HostName`, `User` 설정부터 시작해 `IdentityFile` 경로, 개인키 권한, 공개키 지문, 서버의 `authorized_keys` 순서로 진행하면 된다. 특히 로컬에 `id_ed25519`, `id_rsa`, `.pem` 등 여러 키가 있다면 설정에 지정된 키와 서버에 등록된 공개키가 서로 대응하는지 반드시 비교해야 한다.

마지막으로 `.pem`, `id_rsa`, `id_ed25519` 같은 개인키 파일은 절대 블로그나 외부 저장소에 공개하면 안 된다. 공유가 필요한 경우에도 개인키가 아닌 공개키와 지문만 제한적으로 사용해야 한다.
