---
layout: post
title: "@Embedded와 @Embeddable로 값 객체 매핑하기"
date: 2026-09-17 09:29:11 +0900
categories: ["Backend"]
tags: ["jpa", "hibernate", "entity", "value-object", "embedded"]
---

## 1. 개요

공연 좌석의 위치는 `A구역 3열 12번`처럼 구역, 열, 번호가 함께 의미를 만든다. 이 값을 `Seat` 엔티티에 각각의 필드로 두면 간단해 보이지만, 위치에 관한 검증과 화면 표시 규칙이 엔티티에 섞이기 쉽다.

JPA의 `@Embeddable`과 `@Embedded`는 이런 값을 **값 객체(Value Object)** 로 묶되, 별도 테이블을 만들지 않고 소유 엔티티의 테이블 컬럼에 저장할 수 있게 한다. 이 글에서는 `Seat`와 `SeatPosition` 예제로 두 애너테이션의 역할과 주의점을 정리한다.

---

## 2. `@Embeddable`은 엔티티 안에 넣을 값의 형태를 선언한다

`SeatPosition`은 독립적으로 식별할 필요가 없는 좌석 위치다. 좌석이 사라지면 위치도 따로 남아 있을 이유가 없고, 위치만 단독으로 조회하거나 수정하는 것도 목적이 아니다. 이런 타입에 `@Embeddable`을 붙인다.

```java
import jakarta.persistence.Embeddable;

/** 공연장 안에서 좌석의 위치. 예: A구역 3열 12번 */
@Embeddable
public record SeatPosition(String section, String rowName, int seatNumber) {

    public SeatPosition {
        if (section == null || section.isBlank()) {
            throw new IllegalArgumentException("구역은 비어 있을 수 없다");
        }
        if (rowName == null || rowName.isBlank()) {
            throw new IllegalArgumentException("열은 비어 있을 수 없다");
        }
        if (seatNumber < 1) {
            throw new IllegalArgumentException("좌석 번호는 1 이상이어야 한다: " + seatNumber);
        }
    }

    public String label() {
        return section + "구역 " + rowName + "열 " + seatNumber + "번";
    }
}
```

`SeatPosition`에는 `@Id`가 없다. 즉, 이것은 엔티티가 아니라 엔티티의 상태 일부를 표현하는 값 타입이다. 구역·열·번호를 생성 시점에 함께 검증하고, `label()`처럼 위치와 관련된 동작도 한곳에 둘 수 있다.

`record`는 모든 구성 요소를 불변으로 표현하기에 값 객체의 성격과 잘 맞는다. 다만 레코드 기반 임베디드 타입의 지원 범위는 Jakarta Persistence와 사용하는 JPA 구현체(Hibernate 등)의 버전에 따라 다를 수 있다. 프로젝트 버전에서 지원하지 않는다면 같은 필드를 가진 일반 클래스와 기본 생성자를 사용해야 한다.

---

## 3. `@Embedded`는 값 객체를 엔티티에 포함한다

`Seat`에서 `position` 필드에 `@Embedded`를 붙이면 JPA는 `SeatPosition`을 별도 테이블이나 연관관계로 저장하지 않는다. 대신 `Seat` 테이블의 컬럼으로 펼쳐서 저장한다.

```java
import jakarta.persistence.AttributeOverride;
import jakarta.persistence.AttributeOverrides;
import jakarta.persistence.Column;
import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

@Entity
public class Seat {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long performanceId;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "section", column = @Column(name = "section")),
        @AttributeOverride(name = "rowName", column = @Column(name = "row_name")),
        @AttributeOverride(name = "seatNumber", column = @Column(name = "seat_number"))
    })
    private SeatPosition position;

    @Enumerated(EnumType.STRING)
    private SeatGrade grade;

    private long price;

    public boolean isIn(Schedule schedule) {
        return performanceId.equals(schedule.getPerformanceId());
    }
}
```

위 코드의 `@Embedded`는 "`position`의 필드를 이 엔티티의 컬럼으로 매핑하라"는 뜻이다. `@AttributeOverrides`는 값 객체의 필드명과 실제 DB 컬럼명을 연결한다. 예제처럼 `row_name`, `seat_number`라는 이름을 반드시 사용하려면 명시하는 편이 안전하다. 기본 컬럼명은 JPA 구현체와 프로젝트의 네이밍 전략에 따라 달라질 수 있다.

---

## 4. 테이블에는 어떻게 저장될까?

이 매핑에서 `SeatPosition` 전용 테이블은 생기지 않는다. 개념적으로 `seat` 테이블은 다음과 같은 모습이 된다.

| 컬럼 | 값 예시 | 의미 |
| --- | --- | --- |
| `id` | `1` | 좌석 엔티티의 식별자 |
| `performance_id` | `10` | 좌석이 속한 공연 |
| `section` | `A` | 좌석 위치의 구역 |
| `row_name` | `3` | 좌석 위치의 열 |
| `seat_number` | `12` | 열 안에서의 번호 |
| `grade` | `VIP` | 좌석 등급 |
| `price` | `150000` | 좌석 가격 |

자바에서는 `seat.getPosition().label()`처럼 하나의 객체로 다룰 수 있고, 데이터베이스에서는 좌석 한 행 안에 필요한 값이 들어간다. 따라서 조인 없이 좌석 위치를 함께 조회할 수 있다.

---

## 5. `@Embedded`와 연관관계는 목적이 다르다

`@Embedded`는 객체를 편하게 나누기 위한 매핑이지, 다른 엔티티를 참조하는 연관관계가 아니다. `SeatPosition`은 식별자도 생명주기도 없으며 `Seat`에 포함된 값이다.

| 구분 | `@Embedded` | `@ManyToOne` 같은 연관관계 |
| --- | --- | --- |
| 대상 | 엔티티의 값 일부 | 독립적인 다른 엔티티 |
| 식별자 | 없다 | 보통 `@Id`가 있다 |
| 테이블 | 소유 엔티티 테이블에 컬럼으로 저장 | 외래 키로 다른 테이블을 참조 |
| 예시 | 좌석 위치, 주소, 금액 | 공연, 회원, 주문 |

예를 들어 `Performance`는 여러 `Seat`가 공유하고 독립적으로 관리할 수 있으므로 엔티티나 참조 ID로 모델링할 대상이다. 반면 `SeatPosition`은 특정 `Seat`의 속성으로서 함께 생성되고 사라지므로 임베디드 값으로 두는 것이 자연스럽다.

---

## 6. 같은 타입을 두 번 포함할 때는 컬럼명을 구분한다

주소처럼 동일한 `@Embeddable` 타입을 한 엔티티에서 두 번 사용하면 기본 컬럼명이 충돌할 수 있다. 이때도 `@AttributeOverrides`로 각각 다른 컬럼명을 지정한다.

```java
@Embedded
@AttributeOverrides({
    @AttributeOverride(name = "section", column = @Column(name = "entrance_section")),
    @AttributeOverride(name = "rowName", column = @Column(name = "entrance_row_name")),
    @AttributeOverride(name = "seatNumber", column = @Column(name = "entrance_seat_number"))
})
private SeatPosition entrancePosition;
```

이름만 다를 뿐 매핑 원리는 동일하다. 실제 스키마에 의미가 드러나는 컬럼명을 선택하면 SQL을 읽거나 장애를 점검할 때도 이해하기 쉽다.

---

## 7. 정리

`@Embeddable`은 여러 필드를 하나의 의미 있는 값으로 묶는 타입에 붙이고, `@Embedded`는 그 타입을 엔티티의 일부로 저장할 때 사용한다. `SeatPosition`처럼 구역·열·번호가 항상 함께 다니는 값은 엔티티에 흩어 두는 것보다 하나의 값 객체로 표현하는 편이 규칙과 의도를 분명하게 만든다.

임베디드 타입은 별도 테이블을 만들지 않고 소유 엔티티의 컬럼으로 저장된다. 컬럼명 규칙에 의존하지 않아야 한다면 `@AttributeOverride`로 명시하고, 레코드를 사용한다면 현재 프로젝트의 JPA 구현체와 버전이 지원하는지 확인하자.
